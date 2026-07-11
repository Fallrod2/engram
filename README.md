# engram

Self-hosted spaced-repetition dashboard (FSRS flashcards, AI card/quiz generation, review planning, progress analytics). Localhost-only, single-user, no auth.

## Requirements

- [Bun](https://bun.sh) `1.3+`

## Commands

```bash
bun install          # install workspace dependencies
bun run dev          # server :3001 + web :5173 in parallel
bun run check        # typecheck + lint + prettier check
bun run test         # vitest
```

## Monorepo layout

```
apps/server      # Hono API (:3001)
apps/web         # React 19 + Vite (:5173)
packages/shared  # Zod schemas — single source of truth for API types
```

Copy `.env.example` to `.env` before using AI features.
