# Déploiement Vercel

engram se déploie sur **Vercel** (front statique + API serverless) avec une base
**Postgres Supabase cloud**. Le dev local n'est pas affecté : `bun run dev`, les
gates et les e2e fonctionnent exactement comme avant.

## Architecture cible

- **Front (SPA React/Vite)** : buildé par Vercel, servi en statique depuis
  `apps/web/dist`. Tout chemin non-`/api` qui ne correspond pas à un fichier
  statique retombe sur `index.html` (routing TanStack côté client).
- **API (Hono)** : une fonction serverless Node.js unique, `api/index.ts`, qui
  réutilise **telle quelle** l'app Hono de `apps/server/src/app.ts` via
  `app.fetch`. Le runtime Node de Vercel ne résout pas les imports TS sans
  extension du repo : le `buildCommand` pré-bundle donc tout le serveur avec
  esbuild (`api/app-entry.ts` → `api/app.bundle.mjs`, un seul fichier ESM
  autonome) et `api/index.ts` lazy-importe ce bundle dans le handler (après
  avoir appliqué `ENGRAM_TZ` → `process.env.TZ`). `apps/server/src/index.ts`
  reste l'entrée du dev local (Bun).
- **Routing** : `vercel.json` réécrit `/api/(.*)` vers la fonction (l'URL
  d'origine est préservée, donc le routeur Hono matche `/api/health`, etc.), et
  tout le reste vers `index.html`. Les fichiers statiques existants
  (`/assets/*`) sont servis en priorité, avant les rewrites.

Fichiers ajoutés/modifiés pour Vercel :

| Fichier                                           | Rôle                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `api/index.ts`                                    | Point d'entrée serverless (lazy-import du bundle, `Request → app.fetch`) |
| `api/app-entry.ts`                                | Entrée du bundle esbuild (ré-exporte l'app Hono du serveur)              |
| `api/tsconfig.json`                               | Typecheck de l'entrée sous types Node                                    |
| `vercel.json`                                     | Build (migrations + bundle + front), output, rewrites, `maxDuration`     |
| `apps/server/src/services/generations.service.ts` | `waitUntil` pour le job fire-and-forget sur Vercel                       |

Gate locale associée : `bun run gate:bundle` reconstruit le bundle esbuild, le
boote et vérifie qu'une route protégée répond 401 et que `/api/health` expose
`authEnforced` — preuve que `jose` et le gate d'auth survivent au bundling.

## Configuration du projet Vercel

- **Framework preset** : _Other_ (`framework: null` dans `vercel.json`).
- **Root Directory** : racine du repo.
- **Install Command** : `bun install` (Vercel détecte Bun via `bun.lock` ;
  éventuellement épingler avec `bunVersion` dans `vercel.json` si besoin).
- **Build Command** : défini dans `vercel.json` — trois étapes :
  `bun run --filter @engram/server db:migrate` (migrations Drizzle sur la base
  cloud, cf. § Migrations), puis le bundle esbuild du serveur
  (`api/app-entry.ts` → `api/app.bundle.mjs`), puis
  `bun run --filter @engram/web build` → `apps/web/dist`.
- **Domaine** : `engram.alexabriel.com`.
- **Protection** : **auth applicative Supabase** (le gate décrit en § Auth
  ci-dessous), pas Vercel Authentication. Nuance : Vercel Authentication (Standard
  Protection) **existe** sur Hobby mais **exclut le domaine de production** ; seule
  la portée « All Deployments » — celle qui couvrirait `engram.alexabriel.com` —
  exige Pro/Enterprise. Autrement dit, **la portée qui protège le domaine de prod
  est indisponible sur Hobby**. On protège donc l'app avec une auth applicative
  maison (JWT Supabase vérifiés côté serveur + inscriptions fermées).

## Région d'exécution — `"regions": ["cdg1"]`

`vercel.json` épingle la fonction serverless à **`cdg1` (Paris)**. Ce n'est pas un
détail de confort : **c'est la variable dominante du temps de réponse de l'app.**

**Le problème.** Sans clé `regions`, Vercel place la fonction sur son défaut,
`iad1` (Washington, DC). La base Postgres, elle, est le projet Supabase en
**`eu-west-3` (Paris)**. Chaque aller-retour SQL traversait donc l'Atlantique :
**~80 ms**, mesuré. Et ce coût n'est pas payé par une page en particulier — il
est payé par **chaque requête de chaque écran**, autant de fois qu'elle émet de
requêtes SQL. Le symptôme le plus visible était le semis du compte démo (une
centaine d'allers-retours ⇒ ~15 s d'écran vide), mais un simple
`GET /api/subjects` payait déjà ~80 ms de trajet pour rien.

**Le correctif.** `"regions": ["cdg1"]` au niveau racine de `vercel.json` (clé
documentée : « default deployment area for all functions »). Fonction et base se
retrouvent dans la même ville : l'aller-retour tombe à **quelques millisecondes**.
Le plan **Hobby autorise exactement UNE région** — d'où le tableau à un seul
élément. En ajouter une deuxième ferait échouer le déploiement.

**Ce qu'on perd, et c'est assumé.** Une fonction serverless ne vit qu'à un seul
endroit : la latence qu'on retire aux utilisateurs européens, on l'ajoute aux
autres. Un visiteur nord-américain paie désormais l'aller-retour transatlantique
sur **le trajet navigateur → fonction** (une fois par requête HTTP) au lieu que la
fonction le paie sur **le trajet fonction → base** (une fois par requête SQL, et
une page en émet plusieurs). Le compromis penche donc franchement du bon côté même
pour eux, et l'app est d'abord utilisée depuis l'Europe. Le **front statique**
n'est pas concerné : il reste servi par le CDN, donc depuis le POP le plus proche
du visiteur, où qu'il soit.

**Si la base déménage un jour**, cette clé doit bouger avec elle — sinon on
recrée exactement le problème qu'elle corrige, en silence. La règle est :
`regions` suit la région du projet Supabase, pas les utilisateurs.

## Variables d'environnement (Vercel → Settings → Environment Variables)

> ⚠️ Aucune valeur réelle n'est committée dans le repo. Renseigner ces variables
> uniquement dans le dashboard Vercel (ou via `vercel env`).

| Variable                                                                                 | Requis  | Valeur                                        | Notes                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (ou `POSTGRES_URL`)                                                       | **Oui** | Chaîne du **pooler** Supabase (port **6543**) | Le code accepte les deux noms — `POSTGRES_URL` est celui qu'injecte l'intégration Vercel×Supabase. Le client détecte `:6543` et désactive les prepared statements (`prepare: false`) automatiquement — obligatoire avec le transaction pooler.                                                                            |
| `ENGRAM_TZ`                                                                              | **Oui** | `Europe/Zurich`                               | **Critique.** Vercel tourne en **UTC** par défaut. Le bucketing jour local (study-plan, analytics : heatmap, streaks, temps d'étude) dépend du fuseau du process. Sans `ENGRAM_TZ`, les journées sont décalées.                                                                                                           |
| Clés IA (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`) | Non     | Clés fournisseurs                             | **Replis env seulement** : la config IA (fournisseur actif, modèles, slot OCR) se fait dans l'app — Réglages → IA — et les clés y sont stockées en base, write-only. Sans aucun fournisseur utilisable, génération et OCR renvoient 503 ; le reste fonctionne.                                                            |
| `ENGRAM_ADMIN_USER_ID`                                                                   | **Oui** | UID Supabase de l'admin (Alex)                | Seul utilisateur autorisé à écrire la config IA et à utiliser le backup (spec §3). Absent en prod → ces routes admin renvoient 403 pour tout le monde (fail-closed).                                                                                                                                                      |
| `ENGRAM_DEMO_USER_ID`                                                                    | Non     | UID Supabase du compte démo                   | Optionnel. Quand défini, chaque **nouvelle session** de login de cet utilisateur wipe + reseed le jeu de données démo, et `/api/health` rapporte `demoEnabled:true`. Le user Supabase démo est créé à la main, pas par l'app.                                                                                             |
| `ENGRAM_DEMO_EMAIL`                                                                      | Non     | E-mail du compte démo                         | Avec `ENGRAM_DEMO_PASSWORD` (+ `SUPABASE_URL` et `SUPABASE_ANON_KEY`), active `POST /api/demo/session` et donc le CTA « Essayer la démo » de la landing. Manquant → 503 `demo_unavailable` et `/api/health` rapporte `demoLoginEnabled:false`.                                                                            |
| `ENGRAM_DEMO_PASSWORD`                                                                   | Non     | Mot de passe du compte démo                   | **Secret serveur.** Lu uniquement par `auth/demo-client.ts` ; jamais renvoyé, jamais loggé, jamais dans le bundle (aucun jumeau `VITE_`). Le CTA de la landing n'obtient qu'une paire de tokens de session. Route publique mais qui n'accepte **aucune** entrée du client, et limitée à 10 sessions/min **par instance**. |
| `SUPABASE_URL`                                                                           | **Oui** | Injecté par l'intégration Vercel×Supabase     | Active le gate d'auth serveur (JWKS + issuer). En **prod, l'auth est non désactivable** ; sans cette variable, chaque requête renvoie 500 (fail-closed, cf. § Auth).                                                                                                                                                      |
| `SUPABASE_ANON_KEY`                                                                      | **Oui** | Injecté par l'intégration Vercel×Supabase     | **Publique par design.** Consommée par le build web (mappée en `VITE_SUPABASE_ANON_KEY` via `vite.config`) et, côté serveur, par le login démo (`POST /api/demo/session` appelle GoTrue avec). Ne sert **pas** à la vérification des JWT.                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                              | Non\*   | Injecté par l'intégration                     | **Secret total (bypass RLS).** N'est PAS utilisé par le code applicatif ; seulement pour créer le compte d'Alex une fois (§ Auth) puis **roté**. Ne jamais persister dans un `.env` applicatif.                                                                                                                           |

\* `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont dérivées automatiquement de
`SUPABASE_URL` / `SUPABASE_ANON_KEY` au build par `apps/web/vite.config.ts`
(`define`). Si le `define` posait souci, les déclarer manuellement dans le
dashboard Vercel — l'anon key étant publique, aucun risque.

`ENGRAM_FAKE_AI`, `ENGRAM_AUTH_DISABLED` **et** `ENGRAM_DEV_USER_ID` sont
réservés aux e2e/dev locaux : **ne jamais** les définir sur Vercel.
`ENGRAM_AUTH_DISABLED` est de toute façon **ignoré et loggé** en prod
(`VERCEL=1` ou `NODE_ENV=production`), et `ENGRAM_DEV_USER_ID` n'a d'effet que
quand le gate n'est pas appliqué.

## Auth (gate Supabase)

L'app déployée est protégée par un gate applicatif : GoTrue (Supabase) signe des
JWT, le serveur Hono les vérifie **localement** (JWKS, aucun appel réseau par
requête) sur `/api/*`, et le web présente un écran de login qui injecte le token.
Depuis la migration `0004_multi_user`, les données sont **scopées par
`user_id`** sur les 7 tables de domaine (subjects, decks, cards, review_log,
notes, generations, exams) — chaque utilisateur ne voit que les siennes. La
config IA et les credentials restent globaux à l'instance ; leurs écritures et
le backup sont réservés à `ENGRAM_ADMIN_USER_ID`. **Le gate réel est
applicatif** (`requireUserId` + scoping `user_id`) : le serveur se connecte en
propriétaire du schéma, qui _contourne_ RLS. Les policies RLS posées par
`0004`/`0006`/`0008`/`0009` sont une seconde couche dormante, décrite ci-dessous
(§ « API données (PostgREST) »). Les nouveaux comptes se créent par **invitation**
(Dashboard → Authentication → Users → Invite user) : le lien e-mail atterrit
sur l'écran `/set-password` de l'app.

Étapes de mise en service (une fois) :

1. **Migrer le projet en clés de signature asymétriques.** Dashboard → **Settings
   → JWT (JWT Keys / Signing Keys)** → « Migrate JWT secret » (crée une standby
   ES256) → « Rotate keys » (la standby devient _current_). Après rotation,
   `GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json` sert la clé publique et le
   serveur vérifie en local en ES256. (Les projets récents sont déjà asymétriques
   par défaut ; vérifier que le JWKS renvoie une clé.)

2. **Créer le compte d'Alex (CLOUD-ONLY).** Via l'**Admin API GoTrue cloud** (qui
   bypass `enable_signup`, donc marche même inscriptions fermées). La clé
   `service_role` est un secret total : la saisir sans écho, ne jamais l'écrire
   dans un `.env`, et **la roter juste après**.

   ```bash
   # Depuis une machine de confiance. read -rs : pas d'écho, rien dans l'historique.
   read -rs -p 'SUPABASE_SERVICE_ROLE_KEY: ' SRK; echo
   read -rs -p 'password Alex: ' PW; echo
   curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
     -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"alex.abriel3@gmail.com\",\"password\":\"$PW\",\"email_confirm\":true}"
   unset SRK PW
   # Puis : Dashboard → Settings → API → « Reset service_role » (rotation post-usage).
   ```

   Alternative sans manipuler la clé : Dashboard → **Authentication → Users → Add
   user** en cochant « Auto Confirm User ».

3. **Fermer les inscriptions.** Dashboard → **Authentication → Sign In / Providers
   → Email** → désactiver **« Allow new users to sign up »** (`DISABLE_SIGNUP`).
   Résultat : `POST /auth/v1/signup` → 422 ; seul l'Admin API crée des comptes.

4. **Confirmer que l'intégration injecte** `SUPABASE_URL` + `SUPABASE_ANON_KEY`
   (Settings → Environment Variables). Le build web les consomme via le `define`
   de `vite.config` (§ Variables). Rien d'autre à câbler.

### Fail-closed / déploiement (à ne pas confondre avec un blocage de build)

Un `SUPABASE_URL` manquant en prod **ne bloque pas** le déploiement dans le
dashboard. `api/index.ts` lazy-importe le bundle **dans** le handler `fetch` : le
garde fail-closed ne peut échouer qu'à la **première requête d'un cold start**.
Vercel « déploiera avec succès » puis **chaque requête renverra 500** jusqu'à ce
que l'intégration Supabase soit active. ⇒ **activer l'intégration AVANT d'émettre
du trafic** au premier déploiement.

### API données (PostgREST) — surface fermée

Un projet Supabase expose, **en plus** de l'auth, une API données auto-générée
(PostgREST sur `/rest/v1/*`, plus GraphQL via `graphql_public` — **non couvert**
par `0010`, voir l'angle mort n°2 plus bas) atteignable avec la clé
**`anon`** — qui est publique par construction : elle est compilée dans le bundle
du front. Par défaut, `anon` et `authenticated` reçoivent
`SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` sur **toutes** les
tables de `public`, et sur toutes les **futures** via `ALTER DEFAULT PRIVILEGES`.

engram n'utilise Supabase **que pour l'authentification** : `apps/web` ne
contient aucun `.from(`, `.rpc(`, `.channel(` ni `.storage`, toutes les données
passent par `/api/*`. Cette API données était donc une seconde porte d'entrée,
que le gate `requireUserId` ne protège pas et devant laquelle il ne restait que
RLS. La migration **`0010_revoke_data_api_grants`** la retire :

- `REVOKE ALL` pour `anon` et `authenticated` sur toutes les tables, séquences et
  fonctions de `public` ;
- `ALTER DEFAULT PRIVILEGES ... REVOKE ALL` pour les mêmes rôles, sinon le
  `CREATE TABLE` de la migration suivante leur re-donnerait tout en silence ;
- **`service_role` est laissé intact** : sa clé est un secret, elle n'est
  déployée nulle part ici, et l'outillage Supabase (éditeur de table du
  dashboard, `pg_meta`, backups) passe par lui ;
- **`USAGE ON SCHEMA public` est conservé** : `public` accorde `USAGE` au
  pseudo-rôle `PUBLIC` (`=U/pg_database_owner`), donc le révoquer à `anon` seul
  ne changerait rien, et le révoquer à `PUBLIC` toucherait tous les rôles du
  cluster. Sans le moindre privilège d'objet, `USAGE` n'ouvre l'accès à rien.
- La migration est **portable** : elle se garde sur l'existence des rôles
  (`pg_roles`), car **PGlite** (`bun run test:db`) ne les a pas. À l'inverse, les
  rôles sont **globaux au cluster** : la base jetable des e2e est créée dans la
  stack Supabase locale, qui les possède — les e2e exécutent donc réellement la
  branche `REVOKE` sur un vrai Postgres. La garde y reste utile pour le
  `postgres:16` nu proposé en repli par `e2e/support/db.ts`.

Résultat observé en local (PostgREST + clé `anon`), avant → après :
`GET /rest/v1/card` passe de `200 []` à `401 {"code":"42501","message":
"permission denied for table card"}`, un `POST` de `201 Created` à `401`, et le
document OpenAPI racine passe de 16 tables listées à **aucune**.

#### ⚠️ Ce que `0010` ne ferme PAS — deux angles morts connus

**1. Le grantor `supabase_admin`.** Les privilèges par défaut sont indexés par
**grantor**, et la base de prod en porte **deux** sur `public` : `postgres` et
`supabase_admin`. Le rôle de migration est `postgres`, qui n'est **pas** membre
de `supabase_admin` (ni superuser sur Supabase hébergé) — le filtre
`pg_has_role` de `0010` saute donc cette entrée, et ses
`ALTER DEFAULT PRIVILEGES ... GRANT ALL TO anon, authenticated` **restent actifs
en production** après le déploiement.

C'est jugé **inerte aujourd'hui**, et voici pourquoi (vérifié en lecture sur la
prod, pas supposé) : les privilèges par défaut s'appliquent au rôle qui **crée**
l'objet, et les **15 tables de `public` appartiennent toutes à `postgres`** —
aucune n'a été créée par `supabase_admin`. Tant que le schéma n'est alimenté que
par les migrations Drizzle, l'entrée orpheline ne s'applique à rien.

**Ce qui le rendrait faux demain :** tout objet créé dans `public` **par**
`supabase_admin` — un `CREATE TABLE` depuis la console Supabase si elle passe par
ce rôle, une extension qui installe ses tables dans `public`, un outil de
migration tiers — récupérerait immédiatement les grants `anon`/`authenticated`,
**sans que rien ne le signale** : ni le test `migration-0010.spec.ts` (il tourne
sur PGlite, où ce grantor n'existe pas), ni le linter Supabase, ni le build.
Aucun correctif sûr n'est possible depuis une migration : on ne peut pas
`SET ROLE supabase_admin`, un `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`
ferait **échouer le build Vercel**, et un event trigger défensif exigerait le
superuser, que `postgres` n'a pas. La fermeture propre est un réglage de
dashboard (voir plus bas).

**2. `graphql_public` / pg_graphql.** `0010` porte exclusivement sur le schéma
`public` et **ne couvre pas** `graphql_public`. La fonction
`graphql_public.graphql(...)` vit hors de `public`, appartient à
`supabase_admin`, et son `EXECUTE` est accordé au pseudo-rôle `PUBLIC`
(`=X/supabase_admin`) en plus de `anon`/`authenticated` : la révoquer aux deux
rôles seuls serait **cosmétique**, exactement comme pour `USAGE`. Et nous ne
pourrions pas la révoquer à `PUBLIC` même en le voulant — seul le grantor
(`supabase_admin`) ou un de ses membres le peut.

Ce qui est **mesuré** : `pg_graphql` **n'est pas installé** sur le projet cloud
(extensions présentes : `pg_stat_statements`, `pgcrypto`, `plpgsql`,
`supabase_vault`, `uuid-ossp`). `graphql_public.graphql(...)` y est donc le
_placeholder_ posé par Supabase, qui répond à **toute** requête, introspection
comprise : `{"errors":[{"message":"pg_graphql extension is not enabled."}]}` —
réponse observée en local sur le placeholder identique. L'angle mort est donc
théorique tant que l'extension n'est pas activée.

Ce qui est **du raisonnement, non vérifié** : si `pg_graphql` était activé un
jour, pg_graphql résout sous le rôle appelant réel, donc les `REVOKE` de table de
`0010` devraient s'appliquer aux **données**. En revanche l'**introspection de
schéma** est un mécanisme distinct et pourrait continuer d'exposer les noms de
tables et de colonnes indépendamment de l'accès aux lignes. Une mesure locale a
été tentée (installation de `pg_graphql` sur la stack locale, requêtes
d'introspection et de données avec la clé `anon`) : elle est **non concluante**
— le résolveur renvoyait un schéma vide y compris pour `postgres`, donc l'échec
ne prouvait rien. L'installation locale a été retirée et l'état d'origine
restauré. **À considérer comme non vérifié.**

#### 🔧 Action pour Alex (dashboard, pas migration)

La seule façon de fermer proprement les deux portes **à la fois** — PostgREST et
GraphQL, quel que soit le grantor des privilèges par défaut — est un réglage de
tableau de bord : **Dashboard → Settings → API → « Exposed schemas »**, retirer
`public` (et `graphql_public`) de la liste des schémas servis par l'API données.
Ça ne se fait pas en SQL et ce n'est donc pas dans cette migration. `0010` reste
utile indépendamment : elle protège au niveau des privilèges, y compris si le
réglage est un jour remis par défaut.

**Si l'API données est un jour ouverte volontairement** (client Supabase dans le
front, Realtime, Storage…), il ne suffit pas de re-`GRANT` : il faut, dans une
nouvelle migration, (1) re-`GRANT` uniquement les privilèges **strictement**
nécessaires, table par table et colonne par colonne — jamais `ALL ON ALL
TABLES` ; (2) restaurer les `ALTER DEFAULT PRIVILEGES` correspondants **si et
seulement si** on accepte que toute table future soit exposée (sinon, laisser
les défauts fermés et grant-er explicitement) ; (3) écrire de vraies policies RLS
`FOR SELECT/INSERT/UPDATE/DELETE` avec `WITH CHECK`, adossées à `auth.uid()` et
non à `current_setting('app.user_id')` — les policies actuelles sont écrites pour
le rôle applicatif, pas pour `authenticated` ; (4) mettre à jour le test
`apps/server/src/db/migration-0010.spec.ts`, qui épingle l'invariant « `anon` et
`authenticated` n'ont aucun privilège sur `public` » et échouera au premier
`GRANT`.

#### Pourquoi `admin_audit`, `user_group`, `group_member`, `group_permission` n'ont pas de policy

Le linter Supabase (« RLS enabled, no policy ») signale ces quatre tables. **Ce
n'est pas une régression et il ne faut pas y ajouter de policy** : RLS activé
_sans_ policy signifie **deny-all** pour tout rôle non-propriétaire, ce qui est
exactement l'intention documentée dans `0008_iam_admin.sql` et
`0009_rbac_groups.sql`. Ces tables sont réservées à l'admin et lues par le rôle
applicatif, qui est propriétaire du schéma et contourne RLS. Ajouter une policy
pour faire taire l'avertissement **ouvrirait** un accès afin de satisfaire un
avis automatique : c'est l'inverse du but. Depuis `0010`, `anon` et
`authenticated` n'ont de toute façon plus aucun privilège sur ces tables, donc
l'avertissement porte sur une porte déjà condamnée deux fois.

### `DATABASE_URL` — quel port ?

Utiliser le **Transaction Pooler** Supabase (`...pooler.supabase.com:6543`), pas
la connexion directe `:5432`. Les fonctions serverless sont éphémères et créent
beaucoup de connexions courtes ; le pooler est fait pour ça. Le code gère déjà le
cas `:6543` → `prepare: false` (voir `apps/server/src/db/client.ts`).

## Migrations de base de données

Les migrations Drizzle tournent **à chaque build Vercel** : c'est la première
étape du `buildCommand` (`bun run --filter @engram/server db:migrate`). Le
script de migration préfère la **connexion directe** quand la plateforme en
fournit une (`POSTGRES_URL_NON_POOLING` ou `DATABASE_URL_UNPOOLED` — le DDL à
travers un pooler en mode transaction est à éviter) et retombe sinon sur
`DATABASE_URL`/`POSTGRES_URL` (voir `apps/server/src/db/paths.ts`).

Elles restent applicables manuellement depuis une machine de confiance, en
pointant `DATABASE_URL` sur la base cloud :

```bash
DATABASE_URL='postgresql://…pooler.supabase.com:6543/postgres' bun run db:migrate
```

### `0010_revoke_data_api_grants` — ce qu'elle fait à chaque build

`0010` n'est pas une migration de schéma : elle ne crée ni table ni colonne, elle
**retire des privilèges**. Elle révoque tout ce que `anon` et `authenticated`
détiennent sur `public` (tables, séquences, fonctions) et efface les
`ALTER DEFAULT PRIVILEGES` qui les leur redonneraient sur les objets créés
ensuite. Détail du raisonnement, du choix de garder `USAGE`, des **deux angles
morts assumés** (grantor `supabase_admin`, `graphql_public`) et de la marche à
suivre pour rouvrir l'API données : § « API données (PostgREST) ».

Deux conséquences pratiques pour les migrations **suivantes** :

- une nouvelle table est créée **sans aucun privilège** pour `anon`/
  `authenticated` — c'est voulu, il n'y a rien à faire ;
- un `GRANT ... TO anon` (ou `authenticated`) ajouté par une migration ultérieure
  **casse volontairement** `apps/server/src/db/migration-0010.spec.ts`. Si ce
  test échoue, la question n'est pas « comment le faire passer » mais « qui
  rouvre l'API données, et pourquoi ».

Comme la migration se garde sur `pg_roles`, elle est un no-op silencieux sur
**PGlite**, qui n'a pas ces rôles. Ce n'est **pas** le cas de la base jetable des
e2e : les rôles sont globaux au cluster et cette base est créée dans la stack
Supabase locale, qui les possède — les e2e exécutent donc bien la branche
`REVOKE` sur un vrai Postgres. La migration est aussi rejouable sans erreur (un
`REVOKE` d'un privilège absent réussit).

## `maxDuration` et génération IA

Le POST qui lance une génération renvoie immédiatement une génération `pending` ;
l'appel au fournisseur IA tourne en arrière-plan, maintenu vivant par
`waitUntil`. La fonction doit donc pouvoir vivre assez longtemps :

- `vercel.json` fixe `maxDuration: 300` (5 min) pour `api/index.ts`.
- Avec **Fluid compute** (activé par défaut sur tout nouveau projet Vercel et rien
  ici ne le désactive), le plan **Hobby** autorise déjà 300 s de `maxDuration`,
  comme le plan Pro. Aucun réglage à baisser dans ce cas. Source :
  [Vercel — Functions duration](https://vercel.com/docs/functions/configuring-functions/duration).
- Si un projet exécute encore des fonctions **classiques** (Fluid désactivé), le
  plafond Hobby est plus bas : vérifier la limite en vigueur dans la doc ci-dessus
  et abaisser `maxDuration` en conséquence, en gardant à l'esprit qu'une génération
  multi-chunk peut alors être tronquée (le timeout par appel fournisseur est de 90 s).
- Si la génération IA n'est pas utilisée (aucun fournisseur configuré), la valeur
  n'a aucun impact.

## Compte démo — semis et fenêtre d'initialisation

### Le semis reste **bloquant**, et c'est un choix

Le wipe + reseed du compte démo tourne toujours dans le middleware
(`apps/server/src/http/demo.ts`), dans **une** transaction tenant un verrou
consultatif, sur la première requête authentifiée d'une nouvelle session. Il n'a
pas été basculé en tâche de fond, pour trois raisons :

1. **Il n'y a pas de tâche de fond garantie en serverless.** Une fonction Vercel
   peut être gelée dès la réponse envoyée ; seul `waitUntil` la maintient vivante,
   et encore, dans la limite de `maxDuration`. Un semis en tâche de fond aurait
   donc besoin, de toute façon, du chemin bloquant en filet de reprise.
2. **L'atomicité est ce qui rend le mécanisme correct.** Le marqueur de session
   est écrit dans la même transaction que les données ; aucune requête ne peut
   observer une base à moitié semée. En arrière-plan, la première page se
   chargerait pendant le semis et afficherait un tableau de bord vide — c'est-à-
   dire précisément le bug qu'on corrige.
3. **La garantie d'achèvement vient du client.** Le semis appartient à une requête
   que le navigateur attend : s'il échoue, la transaction est annulée (rien de
   semé), la requête échoue, et la suivante le rejoue. Rien à réconcilier.

Depuis le lot perf, le semis émet **15 requêtes SQL** (contre 101 : une insertion
par carte et par journal de révision). Combiné à `cdg1`, ce n'est plus une attente
de quinze secondes mais quelques centaines de millisecondes.

### `GET /api/demo/status` — un état réel, sans étapes inventées

Route **authentifiée** (elle n'est PAS dans `PUBLIC_ROUTES`) et **réservée au
compte démo** (403 sinon) : elle ne renseigne sur aucun autre utilisateur, ne
renvoie ni identifiant, ni e-mail, ni marqueur de session. C'est la seule route
que le middleware de reset **ignore** — la sonder ne doit jamais déclencher un
semis ni se mettre en file derrière celui qu'elle observe.

```jsonc
{ "state": "pending" | "seeding" | "ready", "readyAt": "2026-07-29T…Z" | null }
```

- `ready` — le marqueur de **cette** session est commité. Seul état où les données
  sont complètes (marqueur et données commitent ensemble).
- `seeding` — un semis tourne **en ce moment** : le serveur voit son verrou
  consultatif tenu dans `pg_locks`. Ce n'est ni une estimation ni un minuteur.
- `pending` — rien de commité pour cette session et rien en cours. Le semis est
  déclenché par la première requête authentifiée qui n'est pas cette sonde.

**Pourquoi pas d'étapes (« matières », « cartes », « révisions »…).** Le semis
tient dans une seule transaction : depuis toute autre connexion, son travail est
**strictement invisible** jusqu'au commit. Une barre de progression par phase
serait donc soit inventée, soit alimentée par un second écrivain hors transaction
— qui coûterait, en écritures et en risque, plus que les ~150 ms qu'il décrirait.
Le verrou consultatif est la seule chose qu'une transaction en cours expose
réellement au reste du cluster : on rapporte ça, et rien de plus.

La fenêtre d'initialisation du front n'en est pas privée de contenu pour autant :
ses premières étapes sont **ses propres actions réelles** (ouvrir la session démo
via `POST /api/demo/session`, l'installer dans le navigateur), et les dernières
sont l'état réel renvoyé ici.

## Vérifier après déploiement

```bash
# Health (public) — doit renvoyer fakeAi:false ET authEnforced:true en prod
# (le corps expose aussi demoEnabled, reflet d'ENGRAM_DEMO_USER_ID, et
#  demoLoginEnabled, reflet d'ENGRAM_DEMO_EMAIL + ENGRAM_DEMO_PASSWORD + Supabase).
curl https://engram.alexabriel.com/api/health
curl -s https://engram.alexabriel.com/api/health | grep '"authEnforced":true'

# Auth forcée : une route protégée sans token → 401 unauthorized.
curl -s -o /dev/null -w '%{http_code}\n' https://engram.alexabriel.com/api/subjects   # 401

# La brèche publique est étroite : seuls GET /api/health et POST /api/demo/session
# passent sans token. Tout le reste, y compris les voisins immédiats, reste 401.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://engram.alexabriel.com/api/demo/session  # 200 (ou 503 si démo non configurée)
curl -s -o /dev/null -w '%{http_code}\n'       https://engram.alexabriel.com/api/demo/session    # 401 (GET)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://engram.alexabriel.com/api/demo/session/ # 401 (slash final)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://engram.alexabriel.com/api/demo          # 401

# La sonde d'initialisation de la démo est authentifiée ET réservée au compte
# démo : sans token → 401, avec le token d'un autre compte → 403.
curl -s -o /dev/null -w '%{http_code}\n' https://engram.alexabriel.com/api/demo/status          # 401

# Région d'exécution : l'en-tête `x-vercel-id` commence par le code de région
# servant la fonction. Attendu `cdg1`, PAS `iad1`.
curl -sI https://engram.alexabriel.com/api/health | grep -i 'x-vercel-id'

# Le front répond en SPA
curl -I https://engram.alexabriel.com/
```

`/api/health` reste **public** (sonde uptime) ; toutes les autres routes `/api/*`
exigent un `Authorization: Bearer <jwt>`. Le login s'obtient sur l'écran `/login`
(compte créé en § Auth).
