# PROGRESS.md — journal de l'orchestrateur

> État vivant du projet. Mis à jour et commité à chaque cycle orchestrateur.

## Phase courante : **Phase 0 — Fondations**

## Fait

- Repo initialisé, docs de pilotage en place (`CLAUDE.md`, `DEV_OPUS.md`, `REVIEWER_SONNET.md`).
- Définitions d'agents installées dans `.claude/agents/` (dev-opus, reviewer-sonnet).

## En cours

- **WS-A `feat/phase0-foundations`** (dev-opus) : racine monorepo (workspaces Bun, tsconfig, eslint flat + prettier, scripts `check`/`test`/`dev`), `packages/shared` (Zod), stubs minimaux `apps/server` (Hono :3001, `/api/health`) et `apps/web` (Vite React :5173), hook pre-commit versionné.

## À venir (Phase 0)

- **WS-B `feat/phase0-server-db`** : Drizzle + schéma complet du domaine + migrations (`data/engram.db`), scripts `db:migrate`/`db:studio`. Dépend de WS-A.
- **WS-C `feat/phase0-design-system`** : Tailwind v4 + shadcn/ui, tokens, thème sombre/clair, app shell avec sidebar, fonts Inter + JetBrains Mono. Dépend de WS-A ; parallèle à WS-B (fichiers disjoints `apps/web` vs `apps/server`).
- Fin de phase : tag `phase-0`.

## Décisions prises

- WS-A est séquentiel (tout le monde en dépend) ; WS-B et WS-C tournent ensuite en parallèle dans des worktrees isolés.
- Conflit attendu sur `bun.lock` entre WS-B et WS-C : résolu par l'orchestrateur en régénérant le lockfile (`bun install`) après le second merge.
- Hook pre-commit versionné dans `.githooks/` + `core.hooksPath` (pas de husky).

## Prochaine étape

- Review de WS-A par reviewer-sonnet, vérification orchestrateur (`bun run check`, `bun run test`, `bun run dev`), merge dans `main`, puis dispatch WS-B + WS-C en parallèle.
