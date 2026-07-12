import { AUTH_API_HEALTH_URL } from './fixtures/auth-env'

/**
 * Boot guard for the OPT-IN auth-ON suite (spec §6.3). Mirrors the default
 * guard but asserts the OPPOSITE of it: the gate MUST be enforced here (auth ON
 * via the HS256 path), and the fake AI generator MUST still be wired.
 */
export default async function globalSetup(): Promise<void> {
  const res = await fetch(AUTH_API_HEALTH_URL)
  if (!res.ok) {
    throw new Error(`e2e auth boot guard: /api/health returned ${res.status}`)
  }
  const body = (await res.json()) as { fakeAi?: unknown; authEnforced?: unknown }
  if (body.fakeAi !== true) {
    throw new Error('e2e auth boot guard: fakeAi != true — check ENGRAM_FAKE_AI=1.')
  }
  if (body.authEnforced !== true) {
    throw new Error(
      'e2e auth boot guard: authEnforced != true — the gate is NOT enforced. ' +
        'Check SUPABASE_JWT_SECRET is set and ENGRAM_AUTH_DISABLED is ABSENT.',
    )
  }
}
