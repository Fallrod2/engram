import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Automatic JSX runtime so component tests (`.test.tsx`) transform without the
  // full React Vite plugin; harmless for the `.ts` node tests (no JSX).
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: {
      // Mirror apps/web's `@/*` path alias so components resolve in tests.
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      // `scripts/` is outside every workspace, so Bun leaves it no
      // `node_modules/@engram/shared` link. Tests there (landing-seed) import
      // the shared Zod schemas at RUNTIME, not just as types, hence the alias.
      '@engram/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Node by default (DB/domain/pure-logic tests). Component tests opt into
    // jsdom per file via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    // Only `*.test.ts` — the Playwright suites are `*.spec.ts` (as are the
    // server's bun:test DB specs), so neither is ever picked up here.
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'packages/**/*.test.ts',
      'e2e/**/*.test.ts',
      // `scripts/landing-seed.ts` builds the dataset every landing capture is
      // taken from. Its invariants (the 12+5 backlog split, the QCM Markdown
      // contract, a year of heatmap history) are only ever observed in a PNG on
      // the public site, so they are asserted here instead.
      'scripts/**/*.test.ts',
    ],
  },
})
