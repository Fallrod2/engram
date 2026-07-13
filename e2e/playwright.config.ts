import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { createRunDb } from './support/db'
import { PORTS, WEB_URL, API_HEALTH_URL } from './fixtures/env'

/**
 * E2E config (Phase 7 §1.3–§1.4, amended for the Postgres/Supabase handoff §14).
 *
 * CRITICAL ORDERING: Playwright starts the `webServer`s BEFORE `globalSetup` and
 * freezes each `webServer.env` when the config module is evaluated. So the
 * throwaway database MUST be created + migrated HERE, in the module body via
 * top-level await, and its URL injected into the server env directly — never in
 * `globalSetup` (which would run too late). `globalSetup` only performs the
 * fake-AI boot guard; `globalTeardown` only drops the database.
 */
// Playwright re-imports this config in each worker process too. Only the MAIN
// process launches the webServers + runs globalSetup/globalTeardown, so only it
// creates (and later drops) the throwaway database. Workers (identified by
// TEST_WORKER_INDEX) get a placeholder — they never start a server, so the URL
// is unused there. Without this guard every worker import would leak an orphan
// database that the teardown (main process only) never drops.
const runDb =
  process.env.TEST_WORKER_INDEX === undefined ? await createRunDb() : { url: '', dbName: '' }

const serverDir = fileURLToPath(new URL('../apps/server', import.meta.url))
const webDir = fileURLToPath(new URL('../apps/web', import.meta.url))

export default defineConfig({
  testDir: './tests',
  // One throwaway database shared by the whole run → strictly sequential.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: fileURLToPath(new URL('./global-setup.ts', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('./global-teardown.ts', import.meta.url)),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Real production entrypoint. Reads PORT + ENGRAM_FAKE_AI + DATABASE_URL.
      command: 'bun run start',
      cwd: serverDir,
      url: API_HEALTH_URL,
      timeout: 30_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(PORTS.api),
        DATABASE_URL: runDb.url,
        ENGRAM_FAKE_AI: '1',
        // Belt-and-suspenders: keep the auth gate OFF for the default suite so
        // the direct API calls in deck-to-stats.spec.ts pass without a token
        // (spec §6.3). Explicit, like ENGRAM_FAKE_AI. The web server does NOT set
        // VITE_SUPABASE_URL, so the web guard is a no-op too.
        ENGRAM_AUTH_DISABLED: '1',
        // Non-empty placeholder so the route's key guard passes; the fake
        // generator answers, so this is NEVER sent to Anthropic.
        ANTHROPIC_API_KEY: 'e2e-fake-key',
        // Deterministic local-day bucketing for analytics/planning.
        TZ: 'Europe/Paris',
      },
    },
    {
      // Prod bundle served by `vite preview` (covers the real build; avoids the
      // dev StrictMode double-invoke). `--strictPort` is mandatory: preview does
      // NOT inherit server.strictPort, so without it Vite would silently fall
      // back to 5274+ and the health check would hang. `preview.proxy` DOES
      // inherit `server.proxy` (Vite resolvePreviewOptions), so /api → :3100.
      command: `bun run build && bun run preview --port ${PORTS.web} --strictPort`,
      cwd: webDir,
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        VITE_API_TARGET: `http://localhost:${PORTS.api}`,
      },
    },
  ],
})
