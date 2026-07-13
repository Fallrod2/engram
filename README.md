# engram

Dashboard de révision self-hosted : flashcards à répétition espacée (FSRS), import de notes (Markdown, PDF, photos) et génération de cartes par IA, planning et analytics de progression.

engram est un outil personnel de révision qui repose sur un vrai moteur de répétition espacée (FSRS v5, via `ts-fsrs`) plutôt qu'une réimplémentation approximative : chaque review nourrit le calcul de la prochaine échéance et alimente les statistiques. Il est pensé d'abord pour un usage EPITA (théorie des langages, anglais, etc.), puis généraliste. Il tourne en **localhost par défaut, sans authentification** (les données restent alors sur la machine), et peut aussi être **déployé sur Vercel + Supabase cloud** derrière une authentification applicative — voir [docs/deploy-vercel.md](docs/deploy-vercel.md).

<picture>
  <source media="(prefers-color-scheme: light)" srcset="apps/web/public/landing/dashboard-light.webp" />
  <img alt="Dashboard engram (thème sombre)" src="apps/web/public/landing/dashboard-dark.webp" />
</picture>

## Fonctionnalités

- **Matières, decks, cartes** — Organisation en matières (couleur, icône, archivage), decks rattachés à une matière, et cartes recto/verso en Markdown. CRUD complet côté API et UI, avec compteurs de cartes dues affichés dans la barre latérale.
- **Session de révision au clavier** — Écran plein écran, 100 % pilotable au clavier : révéler la carte (Espace), noter de 1 à 4 avec prévisualisation des intervalles FSRS pour chaque note, barre de progression, résumé de fin de session (répartition des notes, temps, taux de réussite). Flip de carte animé, gestion des états pause/inactivité, rendu Markdown assaini.
- **Import MD/PDF + génération IA avec review humaine** — Upload de notes Markdown ou PDF (extraction de texte via `unpdf`), prévisualisation, puis génération de cartes par le fournisseur IA configuré. Chaque carte proposée passe par une review humaine carte par carte (accepter / éditer / rejeter / annuler) avant insertion réelle en base. La génération est optionnelle : sans fournisseur IA, l'import et tout le reste fonctionnent.
- **Import photo (OCR)** — Déposer des photos de notes (jpg/png/webp, 10 max par lot) : réduction côté client (long côté ≤ 1568 px, ≤ 4 Mo), transcription en Markdown par un modèle vision, puis prévisualisation photo par photo avec marqueurs d'incertitude (`[?]`, `[illisible]`) et correction manuelle avant la création de la note. L'API ne crée jamais la note elle-même : c'est toujours le texte relu qui est enregistré.
- **IA multi-provider** — Anthropic, OpenRouter, Ollama (local, sans clé), endpoints OpenAI-compatibles et Mistral, configurés dans Réglages → Intelligence artificielle : choix du fournisseur actif et du modèle, test de connexion, liste des modèles disponibles. Les clés API saisies dans l'app sont stockées côté serveur en **write-only** (jamais réaffichées ni renvoyées au client). Un **slot OCR séparé** permet d'utiliser un fournisseur dédié pour la transcription photo — par défaut le même que la génération, ou en mode personnalisé l'API OCR dédiée de Mistral (`/v1/ocr`, `mistral-ocr-latest`).
- **Planning et examens** — Vue calendrier mois/semaine, charge de révisions projetée par jour (dérivée des cartes dues FSRS), examens datés rattachés à des matières avec compte à rebours, et un panneau « à réviser aujourd'hui ». Les examens proches augmentent la charge suggérée sur les jours qui précèdent.
- **Analytics de progression** — Heatmap d'activité type GitHub, streaks, temps d'étude, volume de reviews et rétention par matière. Graphes Recharts doublés d'une vue tabulaire accessible.
- **Auth et multi-utilisateur (fondations)** — Désactivée en local (aucune configuration requise). En déploiement, gate applicatif Supabase : JWT vérifiés localement côté serveur (JWKS ES256, fallback HS256), écran de login, onboarding par lien d'invitation/récupération (`/set-password`). Les données sont scopées par `user_id` sur les 7 tables de domaine ; les routes d'administration (config IA, backup) sont réservées à un utilisateur admin, et un compte démo optionnel est réinitialisé à chaque nouvelle session de connexion.
- **Landing publique** — `/` affiche une page de présentation pour un visiteur non connecté (aussi accessible en direct sur `/welcome`), et le dashboard une fois connecté.
- **Sauvegarde** — Export/import JSON complet de la base depuis les Réglages (admin uniquement).
- **Confort** — Command palette (⌘K), raccourcis clavier sur chaque écran, i18n FR/EN, thème sombre/clair.

## Stack technique

| Domaine                   | Choix                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Runtime / tooling / tests | Bun (runtime, package manager, test runner)                                                        |
| Backend                   | Hono (REST)                                                                                        |
| Base de données           | Postgres via Drizzle ORM — Supabase local en dev (`DATABASE_URL`), Supabase cloud en déploiement   |
| Répétition espacée        | ts-fsrs (FSRS v5+)                                                                                 |
| Frontend                  | React 19 + Vite                                                                                    |
| Routing / data            | TanStack Router (file-based) + TanStack Query                                                      |
| UI                        | Tailwind CSS v4, shadcn/ui, `motion` (animations), Recharts (graphes)                              |
| Validation / types        | Zod — schémas partagés dans `packages/shared` (source de vérité unique de l'API)                   |
| IA                        | Multi-provider côté serveur : Anthropic, OpenRouter, Ollama, OpenAI-compatible, Mistral (dont OCR) |
| Auth                      | Supabase (GoTrue) — JWT vérifiés localement par le serveur (JWKS ES256, fallback HS256)            |
| Extraction PDF            | unpdf                                                                                              |
| Déploiement (optionnel)   | Vercel — front statique + API serverless ([docs/deploy-vercel.md](docs/deploy-vercel.md))          |

## Démarrage

### Prérequis

- [Bun](https://bun.sh) (le projet a été développé sous Bun 1.3.x)
- [Docker](https://docs.docker.com/get-docker/) (démon actif) et la [CLI Supabase](https://supabase.com/docs/guides/cli) — pour la base Postgres locale en dev

### Installation

```bash
bun install
```

### Configuration

Copiez le fichier d'exemple d'environnement :

```bash
cp .env.example .env
```

En local, **rien n'est obligatoire** : sans `DATABASE_URL` le serveur pointe sur la base Supabase locale, l'auth est désactivée, et les fournisseurs IA se configurent dans l'app (Réglages → Intelligence artificielle — les clés y sont stockées côté serveur, en write-only). Variables reconnues :

| Variable                                                                       | Rôle                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY` | Replis env optionnels pour les clés fournisseurs (la config en app prime). Ollama n'utilise pas de clé. Sans aucun fournisseur utilisable, génération et OCR renvoient 503. |
| `DATABASE_URL` (ou `POSTGRES_URL`)                                             | Chaîne de connexion Postgres. Défaut : Supabase locale (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). Ne jamais committer une URL cloud.                      |
| `TZ` (local) / `ENGRAM_TZ` (Vercel)                                            | Fuseau horaire du bucketing « jour » (planning, analytics). En local, le fuseau machine suffit ; sur un hôte UTC il doit être défini.                                       |
| `SUPABASE_URL`                                                                 | Active le gate d'auth serveur (JWKS + issuer). Vide en local → auth OFF, pas d'écran de login.                                                                              |
| `SUPABASE_JWT_SECRET`                                                          | Chemin de vérification HS256 (tests auth, GoTrue local). Optionnel.                                                                                                         |
| `ENGRAM_AUTH_DISABLED=1`                                                       | Bypass d'auth **dev/e2e uniquement** — ignoré (et loggé) en production.                                                                                                     |
| `ENGRAM_DEV_USER_ID`                                                           | `sub` de l'identité par défaut quand le gate n'est pas appliqué (défaut : `dev-user`).                                                                                      |
| `ENGRAM_ADMIN_USER_ID`                                                         | Seul utilisateur autorisé sur les routes admin (écriture config IA, backup). En local le bypass fait office d'admin ; en prod, absent → ces routes renvoient 403 pour tous. |
| `ENGRAM_DEMO_USER_ID`                                                          | Compte démo optionnel : chaque nouvelle session de login de cet utilisateur repart d'un jeu de données fraîchement réinitialisé.                                            |
| `ENGRAM_FAKE_AI=1`                                                             | **Test uniquement** (e2e) : générateur et OCR factices déterministes. Ne jamais activer hors test.                                                                          |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                  | Côté web (valeurs publiques). Vides en local → flow de login désactivé, symétrique du gate serveur.                                                                         |

### Base de données

Démarrez la stack Supabase locale (Postgres + Studio, via Docker), puis appliquez les migrations Drizzle :

```bash
bun run dev:db       # supabase start (Docker requis) — API :54321, DB :54322, Studio :54323
bun run db:migrate   # applique les migrations Drizzle sur la base locale
```

`bun run db:reset` (garde-fou : base locale uniquement) rejoue un schéma propre puis les migrations — utile après une régénération de baseline. `supabase stop` arrête la stack.

### Lancer en développement

```bash
bun run dev          # serveur Hono sur :3001 + web Vite sur :5173 (proxy /api → :3001)
```

L'application est alors accessible sur http://localhost:5173.

### Autres commandes

```bash
bun run check        # typecheck (tsc --noEmit) + lint (eslint) + format check (prettier)
bun run test         # vitest (unitaire + rendu web) puis test:db (intégration DB sous bun test)
bun run test:db      # uniquement les tests d'intégration DB (bun test, PGlite in-process)
bun run test:db:pg   # opt-in : preuves contre le vrai driver postgres-js (Supabase local requis)
bun run test:e2e     # end-to-end Playwright (build web + serveurs réels ; Supabase local requis)
bun run test:e2e:auth # opt-in : e2e avec auth FORCÉE (JWT HS256, sans GoTrue) — ports dédiés
bun run gate:bundle  # gate du bundle serverless : bundle esbuild + boot + vérif 401/authEnforced
bun run dev:db       # supabase start (stack Postgres locale)
bun run db:migrate   # migrations Drizzle
bun run db:reset     # reset schéma local + migrations (garde-fou base locale uniquement)
bun run db:studio    # Drizzle Studio (exploration de la base)
bun run db:generate  # génère une migration à partir du schéma
```

> Les tests d'intégration base de données tournent sous `bun test` (et non Vitest) et s'exécutent sur **PGlite** (Postgres compilé en WASM, in-process, sans démon). La commande `bun run test` enchaîne les deux. `bun run test:db:pg` est optionnel et rejoue un sous-ensemble ciblé contre le vrai Postgres local (rollback transactionnel, agrégats `bigint`) : il nécessite la stack Supabase démarrée.

### Tests end-to-end (Playwright)

Les parcours critiques (matière → deck → cartes → session de révision ; import → génération IA → review → session) sont couverts par Playwright, en full-stack réel : serveur Hono + bundle web de production (`vite preview`).

```bash
bunx playwright install chromium   # une fois : télécharge le navigateur
bun run dev:db                     # la stack Supabase locale doit tourner (Docker)
bun run test:e2e                   # build web + lance les serveurs + joue les scénarios
```

- **Base jetable par run** : `e2e/playwright.config.ts` crée une database Postgres dédiée (`engram_e2e_<run>`) sur l'instance Supabase locale, applique les migrations, l'injecte dans les serveurs, puis la supprime en fin de run. La base `data`/`postgres` de dev n'est jamais touchée.
- **Ports fixes** : API `3100`, web `5273` (hors des plages dev 300x/517x). Une seule invocation `test:e2e` à la fois.
- **Zéro appel IA réel** : le flag test-only `ENGRAM_FAKE_AI=1` câble un générateur **et** un extracteur OCR factices déterministes ; un garde-fou de boot échoue le run si `/api/health` ne rapporte pas `fakeAi:true` (jamais activer `ENGRAM_FAKE_AI` hors test).
- **Suite auth opt-in** : `bun run test:e2e:auth` rejoue les flows avec l'auth **forcée** (vérification HS256 via `SUPABASE_JWT_SECRET`, tokens signés par le test — aucun GoTrue), sur des ports dédiés (API `3110`, web `5283`). Elle ne fait pas partie de la suite par défaut.

## Structure du monorepo

```
engram/
├── api/                 # entrée serverless Vercel (bundle esbuild de apps/server)
├── apps/
│   ├── server/          # Hono + Drizzle + services (fsrs, import, ai, backup, démo)
│   │   └── src/
│   │       ├── routes/  # subjects, decks, cards, review, notes (upload + OCR),
│   │       │            #   generations, exams, study-plan, analytics, backup, ai
│   │       ├── auth/    # résolution de config + vérification JWT (JWKS / HS256)
│   │       ├── db/      # schéma Drizzle (user_id sur les tables de domaine), mappers FSRS
│   │       ├── ai/      # providers (anthropic, openrouter, ollama, openai-compat,
│   │       │            #   mistral), vision/OCR, prompts versionnés
│   │       ├── services/
│   │       └── http/    # enveloppe d'erreur, validation, middlewares auth + démo
│   └── web/             # React 19 + Vite
│       └── src/
│           ├── routes/      # TanStack Router file-based (login, set-password,
│           │                #   welcome, import/photo, settings…)
│           ├── features/    # review, planning, analytics, ocr, ai, auth, landing…
│           ├── components/  # shell, ui (shadcn), import…
│           └── lib/
├── packages/shared/     # schémas Zod + types API (contrat unique)
├── docs/                # deploy-vercel.md…
├── e2e/                 # Playwright (suite par défaut + suite auth opt-in)
└── supabase/            # config.toml de la stack Postgres locale (Supabase CLI)
```

## Raccourcis clavier principaux

Globaux (barre latérale / navigation) :

| Touche                 | Action                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| `⌘K` / `Ctrl+K`        | Ouvrir/fermer la command palette                                     |
| `?`                    | Afficher l'aide des raccourcis                                       |
| `g` puis `d/r/s/p/a/i` | Aller à Aujourd'hui / Session / Matières / Planning / Stats / Import |
| `⌘1`…`⌘9`              | Aller à l'entrée de navigation n° 1…9                                |
| `[`                    | Replier / déplier la barre latérale                                  |
| `↑` `↓` `Home` `End`   | Naviguer dans la barre latérale                                      |

Session de révision :

| Touche              | Action                                                |
| ------------------- | ----------------------------------------------------- |
| `Espace` / `Entrée` | Révéler le verso                                      |
| `1` – `4`           | Noter la carte (Again / Hard / Good / Easy)           |
| `Échap`             | Quitter la session (confirmation), `q` pour confirmer |
| `r`                 | Rejouer une session (écran de résumé)                 |

Review de génération IA (import) :

| Touche                 | Action                                    |
| ---------------------- | ----------------------------------------- |
| `a`                    | Accepter la carte courante                |
| `Shift+A`              | Accepter toutes les cartes en attente     |
| `r`                    | Rejeter la carte courante                 |
| `e`                    | Éditer la carte courante                  |
| `u`                    | Annuler la décision sur la carte courante |
| `j` / `k` (ou `↑` `↓`) | Naviguer entre les cartes proposées       |
| `⌘Entrée`              | Insérer les cartes acceptées              |

Planning :

| Touche          | Action                                   |
| --------------- | ---------------------------------------- |
| `←` `→` `↑` `↓` | Se déplacer dans la grille du calendrier |
| `m` / `s`       | Basculer en vue Mois / Semaine           |
| `t`             | Revenir à aujourd'hui                    |
| `Entrée`        | Ouvrir le détail du jour sélectionné     |
| `n`             | Créer un examen                          |
| `e`             | Éditer l'examen du jour sélectionné      |

Édition (composers de cartes, formulaires) :

| Touche                    | Action  |
| ------------------------- | ------- |
| `⌘Entrée` / `Ctrl+Entrée` | Valider |
| `Échap`                   | Annuler |

## Notes

- **En local** (configuration par défaut : auth désactivée), aucune donnée ne quitte la machine — la base Postgres tourne en local via Supabase/Docker. **Déployée**, l'app est protégée par une auth applicative fail-closed (JWT Supabase vérifiés côté serveur, inscriptions fermées, comptes créés par invitation) ; voir [docs/deploy-vercel.md](docs/deploy-vercel.md).
- Les données vivent dans Postgres. La sauvegarde/restauration se fait par export/import JSON complet depuis les Réglages (réservé à l'admin).
- Aucune clé IA n'est jamais committée. Les clés saisies dans l'app sont stockées côté serveur en write-only et ne sont jamais renvoyées au client ; les variables d'env ne servent que de repli.
- La construction est jalonnée par des tags git `phase-0` → `phase-7` (fondations, cœur FSRS, session de révision, import + IA, planning, analytics, polish, hardening). Les évolutions suivantes (Postgres/Supabase cloud, Vercel, auth, multi-provider IA, OCR photo, multi-user, landing) sont postérieures à `phase-7`.
