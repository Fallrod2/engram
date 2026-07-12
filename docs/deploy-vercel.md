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
  `app.fetch`. `apps/server/src/index.ts` reste l'entrée du dev local (Bun).
- **Routing** : `vercel.json` réécrit `/api/(.*)` vers la fonction (l'URL
  d'origine est préservée, donc le routeur Hono matche `/api/health`, etc.), et
  tout le reste vers `index.html`. Les fichiers statiques existants
  (`/assets/*`) sont servis en priorité, avant les rewrites.

Fichiers ajoutés/modifiés pour Vercel :

| Fichier                                           | Rôle                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `api/index.ts`                                    | Point d'entrée serverless (adaptateur `Request → app.fetch`) |
| `api/tsconfig.json`                               | Typecheck de l'entrée sous types Node                        |
| `vercel.json`                                     | Build du front, output, rewrites, `maxDuration`              |
| `apps/server/src/services/generations.service.ts` | `waitUntil` pour le job fire-and-forget sur Vercel           |

## Configuration du projet Vercel

- **Framework preset** : _Other_ (`framework: null` dans `vercel.json`).
- **Root Directory** : racine du repo.
- **Install Command** : `bun install` (Vercel détecte Bun via `bun.lock` ;
  éventuellement épingler avec `bunVersion` dans `vercel.json` si besoin).
- **Build Command** : `bun run --filter @engram/web build` → `apps/web/dist`.
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

| Variable                    | Requis    | Valeur                                        | Notes                                                                                                                                                                                                           |
| --------------------------- | --------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | **Oui**   | Chaîne du **pooler** Supabase (port **6543**) | Le client détecte `:6543` et désactive les prepared statements (`prepare: false`) automatiquement — obligatoire avec le transaction pooler.                                                                     |
| `ENGRAM_TZ`                 | **Oui**   | `Europe/Zurich`                               | **Critique.** Vercel tourne en **UTC** par défaut. Le bucketing jour local (study-plan, analytics : heatmap, streaks, temps d'étude) dépend du fuseau du process. Sans `ENGRAM_TZ`, les journées sont décalées. |
| `ANTHROPIC_API_KEY`         | Optionnel | Clé API Anthropic                             | Sans clé, la génération IA de cartes/quiz renvoie 503 ; le reste de l'app fonctionne.                                                                                                                           |
| `SUPABASE_URL`              | **Oui**   | Injecté par l'intégration Vercel×Supabase     | Active le gate d'auth serveur (JWKS + issuer). En **prod, l'auth est non désactivable** ; sans cette variable, chaque requête renvoie 500 (fail-closed, cf. § Auth).                                            |
| `SUPABASE_ANON_KEY`         | **Oui**   | Injecté par l'intégration Vercel×Supabase     | **Publique par design.** Consommée par le build web (mappée en `VITE_SUPABASE_ANON_KEY` via `vite.config`). Ne sert pas à la vérification serveur.                                                              |
| `SUPABASE_SERVICE_ROLE_KEY` | Non\*     | Injecté par l'intégration                     | **Secret total (bypass RLS).** N'est PAS utilisé par le code applicatif ; seulement pour créer le compte d'Alex une fois (§ Auth) puis **roté**. Ne jamais persister dans un `.env` applicatif.                 |

\* `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sont dérivées automatiquement de
`SUPABASE_URL` / `SUPABASE_ANON_KEY` au build par `apps/web/vite.config.ts`
(`define`). Si le `define` posait souci, les déclarer manuellement dans le
dashboard Vercel — l'anon key étant publique, aucun risque.

`ENGRAM_FAKE_AI` **et** `ENGRAM_AUTH_DISABLED` sont réservés aux e2e/dev locaux :
**ne jamais** les définir sur Vercel. `ENGRAM_AUTH_DISABLED` est de toute façon
**ignoré et loggé** en prod (`VERCEL=1` ou `NODE_ENV=production`).

## Auth (gate mono-utilisateur Supabase)

L'app déployée est protégée par un gate applicatif : GoTrue (Supabase) signe des
JWT, le serveur Hono les vérifie **localement** (JWKS, aucun appel réseau par
requête) sur `/api/*`, et le web présente un écran de login qui injecte le token.
Aucun changement au schéma applicatif ; multi-comptes + RLS = phase ultérieure.

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

Les migrations Drizzle ne tournent pas pendant le build Vercel. Les appliquer
depuis une machine de confiance, en pointant `DATABASE_URL` sur la base cloud :

```bash
DATABASE_URL='postgresql://…pooler.supabase.com:6543/postgres' bun run db:migrate
```

## `maxDuration` et génération IA

Le POST qui lance une génération renvoie immédiatement une génération `pending` ;
le travail Anthropic tourne en arrière-plan, maintenu vivant par `waitUntil`. La
fonction doit donc pouvoir vivre assez longtemps :

- `vercel.json` fixe `maxDuration: 300` (5 min) pour `api/index.ts`.
- Avec **Fluid compute** (activé par défaut sur tout nouveau projet Vercel et rien
  ici ne le désactive), le plan **Hobby** autorise déjà 300 s de `maxDuration`,
  comme le plan Pro. Aucun réglage à baisser dans ce cas. Source :
  [Vercel — Functions duration](https://vercel.com/docs/functions/configuring-functions/duration).
- Si un projet exécute encore des fonctions **classiques** (Fluid désactivé), le
  plafond Hobby est plus bas : vérifier la limite en vigueur dans la doc ci-dessus
  et abaisser `maxDuration` en conséquence, en gardant à l'esprit qu'une génération
  multi-chunk peut alors être tronquée (le timeout par appel Anthropic est de 90 s).
- Si la génération IA n'est pas utilisée (`ANTHROPIC_API_KEY` absente), la valeur
  n'a aucun impact.

## Vérifier après déploiement

```bash
# Health (public) — doit renvoyer fakeAi:false ET authEnforced:true en prod.
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
