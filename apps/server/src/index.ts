import { app } from './app'

// --- Test-only fake AI generator (e2e, Phase 7 §1.5) ---------------------------
// Wired ONLY here (the server entrypoint), never in `app.ts` (which the unit
// tests import) — so the flag can never take effect through a test import. The
// flag is set exclusively by the e2e launcher; it is absent from `.env.example`
// and forbidden in production. The e2e boot guard (globalSetup) fails the run if
// `/api/health` does not report `fakeAi:true`, so a broken wiring here becomes a
// clean local failure rather than a real Anthropic API call.
if (process.env.ENGRAM_FAKE_AI === '1') {
  const { setCardGenerator } = await import('./ai/generator')
  const { fakeGenerator } = await import('./ai/generator.fake')
  setCardGenerator(fakeGenerator)
  console.warn('[engram] ENGRAM_FAKE_AI actif — générateur factice (NE JAMAIS activer en prod)')
}

// Port from the environment (default 3001) so a dedicated port can be bound for
// the e2e stack without colliding with the dev server. Default unchanged.
const port = Number(process.env.PORT ?? 3001)

// All day/week bucketing (analytics + planning) assumes the process runs in the
// user's timezone. Log the resolved TZ so that assumption is auditable; if
// engram is ever containerized, set `TZ` explicitly to the user's zone.
console.log('[engram] timezone:', Intl.DateTimeFormat().resolvedOptions().timeZone)
console.log(`engram server listening on http://localhost:${port}`)

// Bun serves the default export when it exposes `fetch` + `port`.
export default {
  port,
  fetch: app.fetch,
}
