import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { createRunDb } from './support/db'
import {
  AUTH_PORTS,
  AUTH_WEB_URL,
  AUTH_API_HEALTH_URL,
  AUTH_TEST_SECRET,
} from './fixtures/auth-env'

/**
 * OPT-IN auth-ON e2e (spec §6.3, audit §10). Runs the REAL chain — supabase-js
 * session → `lib/api.ts` header injection → Hono middleware → protected content /
 * 401 redirect — with auth ENFORCED, but with NO GoTrue container: the server
 * verifies via the HS256 path (`SUPABASE_JWT_SECRET`) and the spec mints a token
 * with the same secret. NOT part of the default suite (`test:e2e:auth` only).
 */
const runDb =
  process.env.TEST_WORKER_INDEX === undefined ? await createRunDb() : { url: '', dbName: '' }

const serverDir = fileURLToPath(new URL('../apps/server', import.meta.url))
const webDir = fileURLToPath(new URL('../apps/web', import.meta.url))

export default defineConfig({
  testDir: './tests-auth',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  globalSetup: fileURLToPath(new URL('./global-setup.auth.ts', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('./global-teardown.ts', import.meta.url)),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: AUTH_WEB_URL,
    trace: 'retain-on-failure',
    // Pin the browser language: the app now seeds its initial UI language from
    // `navigator.language` when no choice is stored, and Playwright defaults to
    // en-US. These specs assert the French default copy, so force fr-FR.
    locale: 'fr-FR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Auth ON via HS256: SUPABASE_JWT_SECRET set, ENGRAM_AUTH_DISABLED ABSENT.
      command: 'bun run start',
      cwd: serverDir,
      url: AUTH_API_HEALTH_URL,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(AUTH_PORTS.api),
        DATABASE_URL: runDb.url,
        ENGRAM_FAKE_AI: '1',
        SUPABASE_JWT_SECRET: AUTH_TEST_SECRET,
        ANTHROPIC_API_KEY: 'e2e-fake-key',
        TZ: 'Europe/Paris',
      },
    },
    {
      // Web built with the client auth ON (a non-empty VITE_SUPABASE_URL makes the
      // supabase client non-null → the router guard is active). The URL is never
      // actually contacted: the test injects the session directly into storage.
      command: `bun run build && bun run preview --port ${AUTH_PORTS.web} --strictPort`,
      cwd: webDir,
      url: AUTH_WEB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        VITE_API_TARGET: `http://localhost:${AUTH_PORTS.api}`,
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      },
    },
  ],
})
