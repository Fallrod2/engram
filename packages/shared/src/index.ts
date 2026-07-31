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
  /**
   * True iff `POST /api/demo/session` can actually open a demo session — i.e. the
   * server holds a Supabase URL + anon key AND the demo credentials
   * (`ENGRAM_DEMO_EMAIL` / `ENGRAM_DEMO_PASSWORD`). STRICTLY NARROWER than
   * `demoEnabled`, which only says a demo *account id* is wired for the reset
   * middleware: one can be true without the other. The landing reads THIS one to
   * decide whether to render the "Try the demo" CTA, so activating the demo is a
   * server env change with no front-end redeploy. Never exposes the email, the
   * password, or the demo user id.
   */
  demoLoginEnabled: z.boolean(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

/**
 * Response of `POST /api/demo/session` — the public demo login (landing CTA).
 * Carries ONLY what `supabase.auth.setSession()` needs to install the session in
 * the browser. The demo account's password is server-side only and NEVER appears
 * here (nor in any error body or log).
 */
export const demoSessionResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
})

export type DemoSessionResponse = z.infer<typeof demoSessionResponseSchema>

/**
 * Where the demo account stands **for the caller's own session**. Three states,
 * each read from real server state — none of them is inferred from a timer:
 *
 *  - `ready`   — the session marker committed for THIS session. The seed writes
 *                its whole dataset and that marker in ONE transaction, so `ready`
 *                is the only state in which the account is complete, and there is
 *                no partial-but-usable state in between.
 *  - `seeding` — a seed is executing RIGHT NOW: the server sees its advisory lock
 *                held in `pg_locks`. Not a guess, not an elapsed-time heuristic.
 *  - `pending` — no seed running and none committed for this session. The seed is
 *                triggered by the first authenticated request that is not this
 *                probe, so `pending` means "the work has not started yet".
 *
 * DELIBERATELY NO SUB-STEPS. The seed runs in a single transaction, so from any
 * other connection nothing it does is visible until it commits — a per-phase
 * progress bar could only be fabricated, or bolted on with an out-of-band writer
 * that costs more than the ~150 ms it would describe. See `docs/deploy-vercel.md`
 * (§ Compte démo) for the full argument.
 */
export const demoSeedStateSchema = z.enum(['pending', 'seeding', 'ready'])
export type DemoSeedState = z.infer<typeof demoSeedStateSchema>

/**
 * Response of `GET /api/demo/status` — authenticated, and 403 for anyone who is
 * not the demo account. Exposes no session id, no email, no user id, and nothing
 * about any other account.
 */
export const demoSeedStatusResponseSchema = z.object({
  state: demoSeedStateSchema,
  /** ISO-8601 instant the current dataset was committed; `null` unless `ready`. */
  readyAt: z.string().datetime().nullable(),
})

export type DemoSeedStatusResponse = z.infer<typeof demoSeedStatusResponseSchema>

export * from './domain'
export * from './backup'
export * from './admin'
export * from './qcm'
export * from './search'
