# PROGRESS.md — journal de l'orchestrateur

> État vivant du projet. Mis à jour et commité à chaque cycle orchestrateur.

## Phase courante : **Phase 5 — Analytics** (Phases 0-4 terminées, tags `phase-0` → `phase-4`)

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

### Phase 1 (en cours)

- **WS-1A mergé dans `main`** (ff) : 15 routes REST (CRUD subjects/decks/cards + archivage, review transactionnelle + review_log, file de dues triée/filtrée, preview des 4 intervalles, due counts), service FSRS injectable (ts-fsrs, mappers WS-B réutilisés), couche http (enveloppe d'erreur unique, validation zValidator, réponses validées Zod en sortie), +99 lignes de contrat dans `packages/shared/src/domain.ts`. 91 tests verts (36 vitest + 55 bun:test, harness `test-support/` avec DB temp migrée en preload). Review : APPROVE (0 fix, flow complet vérifié au curl sur :3002). Vérifié par l'orchestrateur : gates + create/delete subject en live sur :3001 (enveloppe d'erreur incluse).
- Note : `app.test.ts` (vitest) remplacé par `app.spec.ts` (bun:test) — app.ts importe bun:sqlite transitivement. Deps ajoutées : `@hono/zod-validator@0.4.3` épinglé + `zod` direct dans apps/server.

- **WS-1B mergé dans `main`** (merge commit) : écrans Subjects / Subject→Decks / Deck→Cards (table dense, composer ⌘↵ enchaînable, glyphes FSRS), sidebar dynamique (vraies matières + due counts réels, refetch + invalidations exactes), factory `qk`, optimistic updates + rollback, RHF + alert-dialog (ajoutés en round de review), redirect `/` → `/subjects` (Phase 1), proxy Vite configurable `VITE_API_TARGET`, vitest racine étendu (jsdom + alias `@`) pour les tests de rendu web. 70 tests vitest + 55 bun:test. Review : APPROVE après 2 rounds (vérifs live par le reviewer, dark+light). Tag `phase-1`.
- Points non bloquants notés par la review : fan-out N+1 côté client pour `cardCount` (faute d'agrégats serveur — candidat Phase 4/5), page unique limit 500 pour les cartes d'un deck (pas d'infinite scroll, à revoir si besoin).

### Phase 2 ✅ (tag `phase-2`)

- **`feat/phase2-review-session` mergé** : session plein écran 100 % clavier (portal, machine à états pure `session-reducer.ts` + timer d'activité `session-timer.ts`, tous testés), flip 3D 220 ms avec branche crossfade reduced-motion, rating 1-4 avec preview des intervalles (couleurs FSRS), progression, résumé de fin (héros, répartition, temps, réussite), empty-state récompense, dialog de sortie, overlay pause/idle, rendu Markdown sûr (react-markdown + rehype-sanitize), entrées « Réviser » sur matière/deck. 128 tests vitest + 55 bun:test. Review : APPROVE en re-revue #2 (anti-double-soumission vérifié en base réelle). Vérifié par l'orchestrateur : gates + session de démo complète déroulée au clavier en live sur :5173 (seed 2 cartes, résumé exact, données de démo supprimées ensuite).
- Points connus : course bénigne « première touche » au mount (StrictMode dev uniquement, non corrigée volontairement) ; le vrai Dashboard « Aujourd'hui » n'existe pas encore (`/` → `/subjects`), le CTA global vit dans la sidebar — à traiter en Phase 4/6.

### Phase 3 — API mergée

- **`feat/phase3-import-api` mergé** : upload multipart 10 MiB (`POST /api/notes/upload`, magic bytes %PDF), extraction unpdf, CRUD notes, module IA `apps/server/src/ai/` (claude-sonnet-4-6, tool_choice forcé, registre de générateur injectable get/set/resetCardGenerator, timeout 90 s/appel, chunking, prompt versionné `prompts/cards.v1.ts`), générations fire-and-forget + polling + resolve transactionnel (items avec cardId gelés, `insertFreshCardRow` partagé), 413/503 dans l'enveloppe d'erreur. 148 vitest + 92 bun:test — AUCUN test n'appelle l'API réelle. Review : APPROVE (0 fix). Vérifié orchestrateur en live sur :3001 : upload MD → extraction ✅, génération sans clé → 503 propre ✅, delete ✅.
- ⚠️ **ANTHROPIC_API_KEY** : à renseigner dans `.env` (jamais commitée) pour la génération réelle ; sans clé, tout le reste fonctionne (503 propre sur la génération uniquement).
- 💡 Grosse feature : candidate à un `/code-review ultra` manuel par Alex (déclenchement et facturation côté Alex).

### Phase 3 UI ✅ (tag `phase-3`) + Phase 4 API mergée

- **`feat/phase3-import-ui` mergé** : /import (dropzone drag&drop + clavier, notes par matière, imports optimistes), /import/$noteId (Markdown rendu, panneau génération, historique, bannière clé API), écran de review (a/e/r/u + Shift+A, j/k, édition inline ⌘↵/Échap, machine locale pure testée, insertion groupée → cartes réelles), polling avec failsafe 90 s, accept/reject monochrome+luminance. Review : APPROVE (1 fix : propagation clavier de l'édition inline). 176 tests vitest.
- **`feat/phase4-planning-api` mergé** : CRUD exams (junction, garde patch vide, 1 requête IN), GET /api/study-plan + /today (bucketing jour local, retard agrégé + ventilé par subject, boost exams ceil(n/7) sur [today, exam-1], filtre subjectId, invariant croisé testé), localDaySchema calendaire (rejette 2026-02-30), localDayDiff robuste DST. Review : APPROVE (0 fix, heuristique reproduite « bit-for-bit » au curl). 307 tests sur la branche.
- Vérifié orchestrateur : gates sur main (180 vitest + 155 bun:test), /import inspecté dans Chrome, endpoints planning smoke-testés en live.
- **Specs Phase 5 prêtes** : API (2 passes d'audit) + UI (validateur dataviz exécuté : pigments subjects non CVD-safe en paires → identité jamais portée par la couleur seule, small multiples, heatmap grille CSS custom avec ramp indigo `--chart-heat-0..4`).

### Phase 4 ✅ (tag `phase-4`) + Phase 5 API mergée

- **`feat/phase4-planning-ui` mergé** : /planning (mois/semaine, grille role=grid clavier 2D, LoadMeter monochrome, exams + Countdown mono, DayDetailPanel, TodayPanel, ExamFormDialog avec date-picker maison — zéro dep ajoutée), helpers calendar.ts purs testés (parse par composantes, jamais new Date('YYYY-MM-DD')), invalidations transverses (session/cards/subjects → planning). APPROVE (2 fix). Bug UTC « exam créé demain s'affiche demain » explicitement vérifié.
- **`feat/phase5-analytics-api` mergé** : 6 requêtes analytics (heatmap, streaks, study-time, review-volume, retention `maturedReviewed`, deck-success), RATING_MIN_COUNTED ≥ 1 prouvé de bout en bout par le reviewer (ligne Manual(0) SQL directe exclue partout), rétrospectives sans filtre archivage, null sous MIN_RATE_SAMPLE=10, 1 requête/endpoint (test spy), TZ loguée au boot. APPROVE (0 fix). 405 tests sur la branche.
- Vérifié orchestrateur : gates main (220 vitest + 219 bun:test), /planning inspecté dans Chrome (empty state), /api/analytics/heatmap smoke-testé.

## En cours (Phase 5 UI + specs 6/7)

- **`feat/phase5-analytics-ui`** (web) : écran Analytics (stat tiles, heatmap grille CSS custom ramp indigo, graphes Recharts, small multiples par matière, table-view jumelle). Ports 3002/5174 (dev), 3003/5175 (reviewer).
- **Specs Phases 6 + 7** (armada, lecture seule) : polish (cmd+K enrichi, raccourcis globaux, transitions, onboarding, i18n FR/EN, vrai Dashboard « Aujourd'hui ») et hardening (e2e Playwright, perf, a11y, backup/export JSON).

## Backlog polish/hardening accumulé (à verser dans les specs 6/7)

- Doublon de titre « Planning » (header global + heading in-page).
- Vrai Dashboard sur `/` (aujourd'hui, TodayPanel, CTA session) — remplace le redirect `/subjects`.
- Responsive planning < 768 : Sheet bas + bascule auto semaine (spec non implémentée, nice-to-have).
- Perf : fan-out N+1 client `cardCount` (agrégats serveur ?), page unique limit 500 cartes/deck, bundle ~700 kB (manualChunks), course bénigne « première touche » session (StrictMode dev only — note QA).
- shadcn `calendar`/`hover-card` non installés (date-picker maison à la place) — choix à confirmer ou standardiser.

## Specs prêtes (suite)

- `phase2-session-spec.md` : machine à états complète (flip espace, rating 1-4 + preview, idle/pause, anti-double-soumission, résumé de fin), 15 findings tracés, API Phase 1 suffisante confirmée.
- `phase3-import-api-spec.md` / `phase3-import-ui-spec.md` : import MD/PDF (unpdf), génération Anthropic (claude-sonnet-4-6, tool use, générateur injectable — tests sans API réelle), polling, review clavier a/e/r/u + j/k, aucun changement de schéma DB requis.

## À venir

- Fin Phase 2 : gates + vérif navigateur du flow session + tag `phase-2`, puis Phase 3 (import + IA, specs prêtes — WS API et UI parallélisables, fichiers disjoints).

## Décisions prises

- Workstreams parallèles → worktrees git isolés sous le scratchpad ; conflits bun.lock résolus par régénération au merge.
- Tests d'intégration DB sous `bun test` (`*.spec.ts`) car vitest s'exécute sous Node (pas de bun:sqlite) ; gate racine `bun run test` enchaîne vitest + test:db.
- `apps/server/src/lib/day.ts` (localDayKey/localMidnight) = référence bucketing jour local pour phases 4-5 (ne pas réimplémenter).
- Ports : :3001/:5173 réservés aux serveurs dev de l'orchestrateur (suivi live Chrome) ; les agents vérifient sur :5174/:5175.

## Prochaine étape

- Merge WS-1A après review, puis dispatch WS-1B. Ne pas s'arrêter entre les phases.
