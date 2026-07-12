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
    },
  },
  test: {
    // Node by default (DB/domain/pure-logic tests). Component tests opt into
    // jsdom per file via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts'],
  },
})
