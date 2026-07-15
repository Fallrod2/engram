import { z } from 'zod'

/**
 * `@engram/shared` is the single source of truth for the API contract.
 * Every request/response shape lives here as a Zod schema; server and web
 * both import the inferred types so they can never drift apart.
 */

/** Response of `GET /api/health`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('engram-server'),
  /** ISO-8601 timestamp, produced server-side. */
  timestamp: z.string().datetime(),
  /**
   * True iff the test-only fake AI generator is wired at runtime (via the
   * `ENGRAM_FAKE_AI` env flag). Always `false` in production — the e2e boot
   * guard aborts the run if it is not `true` during the end-to-end suite, so a
   * broken wiring can never fall through to a real Anthropic API call.
   */
  fakeAi: z.boolean(),
  /**
   * True iff the auth middleware verifies JWTs at runtime (the auth gate is
   * enforced). Always `true` in production — the deploy check asserts it — and
   * `false` in local dev / e2e (where the bypass is active). The e2e boot guard
   * aborts the run if it is not `false`, so the suite never runs with auth ON.
   */
  authEnforced: z.boolean(),
  /**
   * True iff a demo account is configured (`ENGRAM_DEMO_USER_ID` set). Absent in
   * the current prod (no demo) → `false`. The wave-2 landing reads this to decide
   * whether to show a "Try the demo" CTA. Never exposes the demo user id.
   */
  demoEnabled: z.boolean(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export * from './domain'
export * from './backup'
export * from './admin'
