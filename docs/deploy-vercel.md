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
- **Protection** : activer **Vercel Authentication** (Settings → Deployment
  Protection) — c'est la seule barrière d'accès puisque l'app est mono-utilisateur
  et sans auth applicative.

## Variables d'environnement (Vercel → Settings → Environment Variables)

> ⚠️ Aucune valeur réelle n'est committée dans le repo. Renseigner ces variables
> uniquement dans le dashboard Vercel (ou via `vercel env`).

| Variable            | Requis    | Valeur                                        | Notes                                                                                                                                                                                                    |
| ------------------- | --------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | **Oui**   | Chaîne du **pooler** Supabase (port **6543**) | Le client détecte `:6543` et désactive les prepared statements (`prepare: false`) automatiquement — obligatoire avec le transaction pooler.                                                              |
| `TZ`                | **Oui**   | `Europe/Zurich`                               | **Critique.** Vercel tourne en **UTC** par défaut. Le bucketing jour local (study-plan, analytics : heatmap, streaks, temps d'étude) dépend du fuseau du process. Sans `TZ`, les journées sont décalées. |
| `ANTHROPIC_API_KEY` | Optionnel | Clé API Anthropic                             | Sans clé, la génération IA de cartes/quiz renvoie 503 ; le reste de l'app fonctionne.                                                                                                                    |

`ENGRAM_FAKE_AI` est réservé aux e2e locaux : **ne jamais** le définir sur Vercel.

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
- **300 s nécessite un plan Pro** (le plan Hobby plafonne à 60 s). Sur Hobby,
  abaisser à `60` — attention, une génération multi-chunk peut alors être
  tronquée (le timeout par appel Anthropic est de 90 s).
- Si la génération IA n'est pas utilisée (`ANTHROPIC_API_KEY` absente), la valeur
  n'a aucun impact.

## Vérifier après déploiement

```bash
# Health (doit renvoyer {"status":"ok",...,"fakeAi":false})
curl https://engram.alexabriel.com/api/health

# Le front répond en SPA
curl -I https://engram.alexabriel.com/
```

(Derrière Vercel Authentication, ces requêtes nécessitent une session
authentifiée / un bypass token.)
