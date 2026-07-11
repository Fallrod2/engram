# engram — CLAUDE.md

Dashboard de révision self-hosted : flashcards avec spaced repetition (FSRS), import de notes + génération IA de cartes/quiz, planning de révision, analytics de progression. Usage EPITA d'abord, généraliste ensuite. **Localhost uniquement, web (une app viendra peut-être plus tard). Mono-utilisateur, pas d'auth.**

> ⚠️ Ce projet est un outil personnel de révision. Ce n'est PAS un repo EPITA et il ne doit contenir aucun code de projet académique. Le kill-switch académique ne s'applique pas ici.

## Stack (décisions figées — ne pas débattre, ne pas changer)

- **Runtime / tooling** : Bun (runtime, package manager, test runner pour l'unitaire via Vitest)
- **Monorepo** : workspaces Bun — `apps/server`, `apps/web`, `packages/shared`
- **Backend** : Hono (REST + SSE si besoin), SQLite via **Drizzle ORM** (fichier `data/engram.db`), migrations Drizzle
- **Scheduling** : **ts-fsrs** (FSRS v5+). Ne pas réimplémenter l'algo à la main.
- **Frontend** : React 19 + Vite, **TanStack Router** (file-based) + **TanStack Query**, Tailwind CSS v4, **shadcn/ui**, `motion` (framer-motion) pour les animations, **Recharts** pour les graphes
- **Validation** : Zod, schémas partagés dans `packages/shared` (source de vérité unique des types API)
- **IA** : API Anthropic côté serveur uniquement (`ANTHROPIC_API_KEY` dans `.env`, jamais commité). Modèle : `claude-sonnet-4-6`. Génération de cartes/quiz depuis notes MD/PDF.
- **PDF** : extraction texte via `unpdf` côté serveur
- **Tests** : Vitest (unitaire, surtout FSRS/domaine et routes Hono), Playwright (e2e des flows critiques)

## Structure

```
engram/
├── CLAUDE.md
├── PROGRESS.md              # journal de l'orchestrateur, mis à jour à chaque cycle
├── apps/
│   ├── server/              # Hono + Drizzle + services (fsrs, import, ai)
│   └── web/                 # React (routes/, components/, features/, lib/)
├── packages/shared/         # schémas Zod + types API
├── data/                    # sqlite (gitignored)
└── e2e/                     # Playwright
```

## Modèle de domaine (v1)

- `subject` (matière : ex. "Théorie des langages", "Anglais") → couleur, icône, archivable
- `deck` (appartient à un subject) → cartes
- `card` : recto/verso Markdown (+ cloze plus tard), état FSRS (due, stability, difficulty, reps, lapses, state)
- `review_log` : chaque review (rating 1-4, durée, scheduled vs actual) — c'est la matière première des analytics
- `note` : document importé (MD/PDF), texte extrait, lié à un subject
- `generation` : trace d'une génération IA (note source, cartes produites, statut accepté/rejeté par carte)
- `exam` : échéance datée liée à des subjects (alimente le planning)
- `study_plan` : charge de révision projetée par jour (dérivée des dues FSRS + exams)

## Phases (l'orchestrateur les exécute dans l'ordre ; chaque phase se termine par un tag git `phase-N`)

- **Phase 0 — Fondations** : scaffolding monorepo, Drizzle + migrations, design system (tokens, thème sombre/clair, layout app shell avec sidebar), scripts `bun run check` (typecheck + lint + format), CI locale via hook pre-commit.
- **Phase 1 — Cœur FSRS** : CRUD subjects/decks/cards, moteur FSRS branché (ts-fsrs), file de cartes dues, API complète testée.
- **Phase 2 — Session de révision** : l'écran le plus important de l'app. Flow flip-card au clavier (espace = révéler, 1-4 = rating), animations soignées, barre de progression, résumé de fin de session. Doit être *agréable* — c'est là que l'utilisateur passe son temps.
- **Phase 3 — Import + IA** : upload MD/PDF, extraction, prévisualisation, génération de cartes/quiz par Claude avec review humaine (accepter/éditer/rejeter carte par carte avant insertion). Prompt de génération dans `apps/server/src/ai/prompts/`.
- **Phase 4 — Planning** : vue calendrier (mois + semaine), charge prévisionnelle de reviews/jour, exams avec compte à rebours, suggestion "quoi réviser aujourd'hui".
- **Phase 5 — Analytics** : heatmap type GitHub, rétention par subject, forecast de charge, streaks, temps d'étude, taux de réussite par deck.
- **Phase 6 — Polish** : command palette (cmd+k), raccourcis clavier globaux, transitions de pages, empty states illustrés, onboarding, i18n FR/EN.
- **Phase 7 — Hardening** : e2e Playwright sur les flows critiques (créer deck → ajouter cartes → session → stats ; import → génération → session), audit perf, accessibilité (focus, ARIA), backup/export JSON de la DB.

## UI/UX — exigences non négociables

- Direction : sobre, dense mais respirant, type Linear/Raycast. Dark mode par défaut, light disponible. Pas d'UI "bootstrap générique".
- Typo : Inter (UI) + JetBrains Mono (données/code). Échelle typographique cohérente.
- Tout est navigable au clavier. La session de révision se fait 100 % sans souris.
- États de chargement = skeletons, jamais de spinner plein écran. Optimistic updates via TanStack Query.
- Animations : subtiles, < 250 ms, `motion` uniquement. Le flip de carte est le seul moment "spectaculaire" autorisé.
- Chaque écran doit avoir un empty state pensé (pas un div vide).

## Règles Git (strictes)

- **Conventional commits** : `feat(web): ...`, `fix(server): ...`, `test:`, `chore:`, `docs:`.
- **Committer souvent** : après chaque unité cohérente (~20-40 min de travail max entre deux commits). Jamais de commit fourre-tout de fin de phase.
- Interdiction de committer si `bun run check` ou les tests échouent.
- Une branche par workstream (`feat/phase2-review-session`), mergée dans `main` par l'orchestrateur **uniquement après review approuvée**.
- `PROGRESS.md` mis à jour et commité à chaque fin de cycle orchestrateur.

## Quality gates (à vérifier avant tout merge)

1. `bun run check` passe (tsc --noEmit, eslint, prettier)
2. `bun run test` passe ; tout nouveau code de domaine (FSRS, planning, import) a des tests
3. Les schémas Zod de `packages/shared` sont la seule source des types API (pas de types dupliqués à la main)
4. Aucune clé/secret dans le code ; `.env.example` à jour
5. Le serveur démarre (`bun run dev`) et la feature est vérifiable dans le navigateur

## Commandes

```bash
bun install
bun run dev          # server :3001 + web :5173 en parallèle
bun run check        # typecheck + lint + format check
bun run test         # vitest (.test.ts) + test:db (intégration DB via bun:test)
bun run test:db      # tests d'intégration DB (cascade FK, round-trip FSRS, DTO) — bun test *.spec.ts
bun run test:e2e     # playwright
bun run db:migrate   # drizzle migrations
bun run db:studio    # drizzle studio
```
