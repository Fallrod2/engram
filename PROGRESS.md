# PROGRESS.md — journal de l'orchestrateur

> État vivant du projet. Mis à jour et commité à chaque cycle orchestrateur.

## Phase courante : **Phase 0 — Fondations**

## Fait

- Repo initialisé, docs de pilotage en place (`CLAUDE.md`, `DEV_OPUS.md`, `REVIEWER_SONNET.md`).
- Définitions d'agents installées dans `.claude/agents/` (dev-opus, reviewer-sonnet).
- Bun 1.3.14 installé sur la machine (Homebrew).
- **WS-A mergé dans `main`** (ff, branche supprimée) : monorepo Bun workspaces, tsconfig strict (ES2022, noUncheckedIndexedAccess, verbatimModuleSyntax), ESLint 9 flat + Prettier, `packages/shared` (`healthResponseSchema` Zod), `apps/server` (Hono :3001, `GET /api/health` validé par le schéma partagé), `apps/web` (Vite React 19 :5173, proxy `/api` → :3001), Vitest (5 tests verts), hook pre-commit `.githooks/` + `core.hooksPath` via script `prepare`. Review Sonnet : APPROVE (0 correctif). Vérifié par l'orchestrateur : check ✅ test ✅ dev + curls ✅.

## En cours

- Workflow `phase0-specs` (armada) : spec DB (draft Opus vérifié contre les vrais `.d.ts` de ts-fsrs → critique Sonnet → révision) + spec design (panel 3 directions Opus → juge). Sorties attendues dans le scratchpad (`specs/ws-b-db-spec.md`, `specs/ws-c-design-spec.md`).

## À venir (Phase 0)

- **WS-B `feat/phase0-server-db`** : Drizzle + schéma complet du domaine + migrations (`data/engram.db`), scripts `db:migrate`/`db:studio`. Basé sur la spec DB.
- **WS-C `feat/phase0-design-system`** : Tailwind v4 + shadcn/ui, tokens, thème sombre/clair, app shell avec sidebar, fonts Inter + JetBrains Mono. Basé sur la spec design ; parallèle à WS-B (fichiers disjoints `apps/web` vs `apps/server`).
- Fin de phase : tag `phase-0`.

## Décisions prises

- WS-A est séquentiel (tout le monde en dépend) ; WS-B et WS-C tournent ensuite en parallèle dans des worktrees isolés.
- Conflit attendu sur `bun.lock` entre WS-B et WS-C : résolu par l'orchestrateur en régénérant le lockfile (`bun install`) après le second merge.
- Hook pre-commit versionné dans `.githooks/` + `core.hooksPath` (pas de husky).

## Prochaine étape

- Review de WS-A par reviewer-sonnet, vérification orchestrateur (`bun run check`, `bun run test`, `bun run dev`), merge dans `main`, puis dispatch WS-B + WS-C en parallèle.
