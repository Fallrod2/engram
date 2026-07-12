import { API_HEALTH_URL } from './fixtures/env'

/**
 * Fake-AI boot guard (Phase 7 §1.5). Playwright starts the `webServer`s and
 * waits for their URLs BEFORE running this globalSetup, so the API is already
 * up. It does NOT create the database (that happens in the config body, §1.4);
 * its ONLY job is to fail the whole run — before any spec — if the server did
 * not wire the fake generator. Without this, a broken `ENGRAM_FAKE_AI` wiring
 * would leave the real Anthropic generator active (the guard route passes on the
 * non-empty `e2e-fake-key`) → a real API call during the suite.
 */
export default async function globalSetup(): Promise<void> {
  const res = await fetch(API_HEALTH_URL)
  if (!res.ok) {
    throw new Error(`e2e boot guard: /api/health returned ${res.status}`)
  }
  const body = (await res.json()) as { fakeAi?: unknown; authEnforced?: unknown }
  if (body.fakeAi !== true) {
    throw new Error(
      'e2e boot guard: /api/health reports fakeAi != true — the fake AI generator is NOT wired. ' +
        'Aborting before any spec so no real Anthropic API call can happen. ' +
        'Check ENGRAM_FAKE_AI=1 and the wiring in apps/server/src/index.ts.',
    )
  }
  // The default suite MUST run with the auth gate OFF (spec §6.3): the specs hit
  // the API directly without a token, so an accidentally-enforced gate would
  // 401 everything. Fail the whole run before any spec if auth is ON.
  if (body.authEnforced !== false) {
    throw new Error(
      'e2e boot guard: /api/health reports authEnforced != false — the auth gate is ENFORCED. ' +
        'The default suite runs auth OFF; check ENGRAM_AUTH_DISABLED=1 and that no ' +
        'SUPABASE_URL/SUPABASE_JWT_SECRET leaked into the server env.',
    )
  }
}
