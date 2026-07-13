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

## Variables d'environnement (Vercel → Settings → Environment Variables)

> ⚠️ Aucune valeur réelle n'est committée dans le repo. Renseigner ces variables
> uniquement dans le dashboard Vercel (ou via `vercel env`).

| Variable                                                                                 | Requis  | Valeur                                        | Notes                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (ou `POSTGRES_URL`)                                                       | **Oui** | Chaîne du **pooler** Supabase (port **6543**) | Le code accepte les deux noms — `POSTGRES_URL` est celui qu'injecte l'intégration Vercel×Supabase. Le client détecte `:6543` et désactive les prepared statements (`prepare: false`) automatiquement — obligatoire avec le transaction pooler.                 |
| `ENGRAM_TZ`                                                                              | **Oui** | `Europe/Zurich`                               | **Critique.** Vercel tourne en **UTC** par défaut. Le bucketing jour local (study-plan, analytics : heatmap, streaks, temps d'étude) dépend du fuseau du process. Sans `ENGRAM_TZ`, les journées sont décalées.                                                |
| Clés IA (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`) | Non     | Clés fournisseurs                             | **Replis env seulement** : la config IA (fournisseur actif, modèles, slot OCR) se fait dans l'app — Réglages → IA — et les clés y sont stockées en base, write-only. Sans aucun fournisseur utilisable, génération et OCR renvoient 503 ; le reste fonctionne. |
| `ENGRAM_ADMIN_USER_ID`                                                                   | **Oui** | UID Supabase de l'admin (Alex)                | Seul utilisateur autorisé à écrire la config IA et à utiliser le backup (spec §3). Absent en prod → ces routes admin renvoient 403 pour tout le monde (fail-closed).                                                                                           |
| `ENGRAM_DEMO_USER_ID`                                                                    | Non     | UID Supabase du compte démo                   | Optionnel. Quand défini, chaque **nouvelle session** de login de cet utilisateur wipe + reseed le jeu de données démo, et `/api/health` rapporte `demoEnabled:true` (CTA démo de la landing). Le user Supabase démo est créé à la main, pas par l'app.         |
| `SUPABASE_URL`                                                                           | **Oui** | Injecté par l'intégration Vercel×Supabase     | Active le gate d'auth serveur (JWKS + issuer). En **prod, l'auth est non désactivable** ; sans cette variable, chaque requête renvoie 500 (fail-closed, cf. § Auth).                                                                                           |
| `SUPABASE_ANON_KEY`                                                                      | **Oui** | Injecté par l'intégration Vercel×Supabase     | **Publique par design.** Consommée par le build web (mappée en `VITE_SUPABASE_ANON_KEY` via `vite.config`). Ne sert pas à la vérification serveur.                                                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                                              | Non\*   | Injecté par l'intégration                     | **Secret total (bypass RLS).** N'est PAS utilisé par le code applicatif ; seulement pour créer le compte d'Alex une fois (§ Auth) puis **roté**. Ne jamais persister dans un `.env` applicatif.                                                                |

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
le backup sont réservés à `ENGRAM_ADMIN_USER_ID`. RLS n'est pas utilisé (le
scoping est applicatif). Les nouveaux comptes se créent par **invitation**
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

## Vérifier après déploiement

```bash
# Health (public) — doit renvoyer fakeAi:false ET authEnforced:true en prod
# (le corps expose aussi demoEnabled, reflet d'ENGRAM_DEMO_USER_ID).
curl https://engram.alexabriel.com/api/health
curl -s https://engram.alexabriel.com/api/health | grep '"authEnforced":true'

# Auth forcée : une route protégée sans token → 401 unauthorized.
curl -s -o /dev/null -w '%{http_code}\n' https://engram.alexabriel.com/api/subjects   # 401

# Le front répond en SPA
curl -I https://engram.alexabriel.com/
```

`/api/health` reste **public** (sonde uptime) ; toutes les autres routes `/api/*`
exigent un `Authorization: Bearer <jwt>`. Le login s'obtient sur l'écran `/login`
(compte créé en § Auth).
