# PROGRESS.md — journal de l'orchestrateur

> État vivant du projet. Mis à jour et commité à chaque cycle orchestrateur.

## Phase courante : **Phase 1 — Cœur FSRS** (Phase 0 terminée, tag `phase-0`)

## Fait

### Phase 0 — Fondations ✅ (tag `phase-0`)

- Docs de pilotage + agents `.claude/agents/` (dev-opus, reviewer-sonnet). Bun 1.3.14 installé.
- **WS-A** (mergé ff) : monorepo Bun workspaces, tsconfig strict, ESLint 9 flat + Prettier, `packages/shared` (Zod), `apps/server` Hono :3001 `/api/health`, `apps/web` Vite React 19 :5173 (proxy `/api`), Vitest, hook pre-commit `.githooks/`. Review : APPROVE (0 fix).
- **WS-B** (mergé ff) : Drizzle + bun:sqlite, schéma complet v1 (subject, deck, card, review_log, note, generation, exam, exam_subject ; study_plan = dérivé, pas de table), champs FSRS = ts-fsrs@5.4.1 vérifiés champ par champ, dates integer ms, FK cascade/set-null, index, migration `0000` versionnée, `db:generate/migrate/studio`, mappers FSRS + DTO (frontière Zod/Drizzle anti-drift), `packages/shared/src/domain.ts` = contrat API. Tests : 29 vitest + 8 bun:test (`test:db`, intégration réelle bun:sqlite — vitest tourne sous Node, incompatible bun:sqlite). Review : APPROVE (1 fix : câblage test:db dans le script `test` racine).
- **WS-C** (merge commit, conflit bun.lock résolu par régénération) : design system « Précision Linear » (juge du panel 3 directions) — tokens OKLCH @theme Tailwind v4 dark+light, Inter Variable + JetBrains Mono Variable self-hostées (@fontsource), 20 primitives shadcn/ui restylées, sidebar custom 240px/64px (roving tabindex, `[` collapse, ⌘K palette, ⌘1-9), TanStack Router file-based + Query, 6 routes placeholder avec empty states, thème persistant. Review : APPROVE (0 fix, vérif visuelle Chrome réelle).
- Micro-fixes orchestrateur post-merge : `.prettierignore` (drizzle/ + routeTree.gen.ts, formats imposés par les outils) ; **dark par défaut** sans préférence stockée (CLAUDE.md) — `system` reste un choix explicite persisté.
- Vérifications orchestrateur : `bun run check` ✅, `bun run test` (29+8) ✅, `db:migrate` ✅ (data/engram.db, 8 tables), serveurs dev relancés, app shell vérifiée visuellement dans Chrome (dark, sidebar, empty states, indicateur API).

### Specs prêtes (scratchpad de session `/private/tmp/claude-501/.../scratchpad/specs/`)

- `ws-b-db-spec.md`, `ws-c-design-spec.md` (consommées par Phase 0).
- `phase1-api-spec.md` : 15 routes REST (CRUD subjects/decks/cards, due queue, review, preview, due counts), service FSRS injectable, format d'erreur unique, 59 tests nominatifs. Auditée (8 corrections intégrées).
- `phase1-ui-spec.md` : écrans Subjects / Subject→Decks / Deck→Cards, due counts sidebar réels, conventions Query/Router, composer clavier (⌘↵), composants DueCount/FsrsStateGlyph/EmptyState…, dépendances dures [DÉP-API] listées.

## En cours (Phase 1)

- **WS-1A `feat/phase1-api`** (dev Opus + review Sonnet, worktree isolé) : routes + services FSRS + schémas shared, selon `phase1-api-spec.md`.
- **Specs Phase 2** (armada) : spec UX de la session de révision (flow clavier, flip, résumé de fin) — en avance de phase.

## À venir

- **WS-1B `feat/phase1-ui`** : écrans CRUD web selon `phase1-ui-spec.md` — démarre après merge de WS-1A (dépendance dure sur l'API).
- Fin Phase 1 : gates + vérif navigateur + tag `phase-1`, puis Phase 2 (session de révision).

## Décisions prises

- Workstreams parallèles → worktrees git isolés sous le scratchpad ; conflits bun.lock résolus par régénération au merge.
- Tests d'intégration DB sous `bun test` (`*.spec.ts`) car vitest s'exécute sous Node (pas de bun:sqlite) ; gate racine `bun run test` enchaîne vitest + test:db.
- `apps/server/src/lib/day.ts` (localDayKey/localMidnight) = référence bucketing jour local pour phases 4-5 (ne pas réimplémenter).
- Ports : :3001/:5173 réservés aux serveurs dev de l'orchestrateur (suivi live Chrome) ; les agents vérifient sur :5174/:5175.

## Prochaine étape

- Merge WS-1A après review, puis dispatch WS-1B. Ne pas s'arrêter entre les phases.
