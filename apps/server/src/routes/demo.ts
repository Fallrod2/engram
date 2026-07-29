import { Hono } from 'hono'
import {
  apiErrorSchema,
  demoSeedStatusResponseSchema,
  demoSessionResponseSchema,
} from '@engram/shared'
import { ok } from '../http/respond'
import { DemoUnavailableError, ForbiddenError, UpstreamError } from '../http/errors'
import { requireUserId } from '../http/identity'
import { resolveAuthConfig } from '../auth/config'
import { resolveDemoAuthClient } from '../auth/demo-client'
import { db } from '../db/client'
import { isDemoProfile } from '../services/profile.service'
import { DEMO_NO_SESSION, demoSeedStatus } from '../services/demo.service'

/**
 * `POST /api/demo/session` — the ONLY public (unauthenticated) write route of the
 * API, serving the landing's "Try the demo" CTA. Its exemption from the JWT gate
 * is a single, exact, method-scoped entry in `http/auth.ts`'s `PUBLIC_ROUTES`.
 *
 * Three invariants make that exemption safe:
 *
 *  1. IT READS NOTHING FROM THE CALLER. The request body is never parsed, no
 *     query param is read, no header is honoured. The credentials come from the
 *     server environment (`ENGRAM_DEMO_EMAIL` / `ENGRAM_DEMO_PASSWORD`) and
 *     nowhere else. A caller who posts `{email,password}` gets a session for the
 *     demo account, exactly as if they had posted nothing — so this can never
 *     degrade into an open login proxy or a credential-stuffing oracle.
 *  2. IT LEAKS NOTHING. The response carries the two session tokens and nothing
 *     else; the demo password appears in no response, no error message and no log
 *     (see `auth/demo-client.ts`).
 *  3. IT IS RATE-LIMITED (see below) — because every new demo session costs a
 *     full wipe+reseed of the demo dataset on the next authenticated request.
 *
 * Not configured (any of URL / anon key / email / password missing) → a clean 503
 * `demo_unavailable`, never a 500. `/api/health.demoLoginEnabled` mirrors the same
 * predicate, so the front knows at runtime whether to show the CTA at all.
 */

/* ------------------------------------------------------------ rate limiting -- */

/** Sessions granted per window, process-wide (not per IP — see the note below). */
const RATE_LIMIT_MAX = 10
/** Fixed window length, in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60_000

let windowStart = 0
let windowCount = 0

/**
 * A deliberately dumb fixed-window counter, shared by every caller of this route.
 *
 * WHAT IT PROTECTS. Each *new* demo session makes `http/demo.ts` wipe and reseed
 * the whole demo dataset (25 cards + logs + an exam) inside a transaction holding
 * an advisory lock, on the next authenticated request. Left unbounded, a script
 * hitting this endpoint in a loop would keep the database busy re-seeding and
 * serialize behind that lock. The counter bounds how often that can be triggered
 * through us.
 *
 * WHAT IT DOES **NOT** PROTECT — read this before trusting it:
 *  - It is PER PROCESS. In production the app runs as Vercel serverless
 *    functions, so this counter lives in ONE lambda instance's memory. N warm
 *    instances mean up to N × RATE_LIMIT_MAX sessions per window, and a cold
 *    start resets the count to zero. There is NO global guarantee here, and this
 *    is not a substitute for one; a real global limit would need a shared store.
 *    The genuine global backstop is GoTrue's own rate limiting on
 *    `/auth/v1/token`, which we do not control from here.
 *  - It is NOT per IP and NOT fair. One client hammering the route exhausts the
 *    shared window and the demo is briefly unavailable to everyone else on that
 *    instance. That trade is intentional: the resource being protected (the demo
 *    dataset and its lock) is itself shared and global, so a global budget is the
 *    honest shape. Per-IP buckets on a serverless host would also be trivially
 *    defeated and would grow unbounded in memory.
 *  - It bounds SESSION CREATION, not reads. Everything a demo visitor does after
 *    logging in goes through the normal authenticated gate and is not counted.
 *
 * Returns the remaining window in seconds when the budget is exhausted, for
 * `Retry-After`.
 */
function takeDemoSessionSlot(now = Date.now()): { allowed: true } | { retryAfterSeconds: number } {
  if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
    windowStart = now
    windowCount = 0
  }
  if (windowCount >= RATE_LIMIT_MAX) {
    const remainingMs = RATE_LIMIT_WINDOW_MS - (now - windowStart)
    return { retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) }
  }
  windowCount += 1
  return { allowed: true }
}

/** Test seam: drop the current window so each spec starts with a full budget. */
export function __resetDemoRateLimitForTests(): void {
  windowStart = 0
  windowCount = 0
}

/** Exposed so the specs assert the documented budget instead of hard-coding it. */
export const DEMO_RATE_LIMIT = { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS } as const

/* -------------------------------------------------------------------- route -- */

export const demoRouter = new Hono()

demoRouter.post('/session', async (c) => {
  // NOTE: `c.req` is never read AT ALL in this handler — not the body, not the
  // query, not a header (the rate limiter is a global counter and reads nothing
  // either). Do not add any request parsing here; invariant 1 depends on it, and
  // `demo-session.spec.ts` fails the moment caller input can reach the upstream.
  const client = resolveDemoAuthClient(resolveAuthConfig(process.env))
  if (!client) throw new DemoUnavailableError()

  const slot = takeDemoSessionSlot()
  if (!('allowed' in slot)) {
    c.header('Retry-After', String(slot.retryAfterSeconds))
    return c.json(
      apiErrorSchema.parse({
        error: {
          code: 'rate_limited',
          message: 'Trop de connexions à la démo. Réessaie dans un instant.',
        },
      }),
      429,
    )
  }

  try {
    const tokens = await client.signIn()
    return ok(c, demoSessionResponseSchema, tokens)
  } catch {
    // The caught error is DISCARDED, not inspected and not logged: the call that
    // failed is the one that carried the demo password, so neither its message
    // nor its cause is allowed anywhere near a response or a log line. The client
    // only needs to know the demo is unavailable right now.
    throw new UpstreamError('La démo est momentanément indisponible.')
  }
})

/**
 * `GET /api/demo/status` — how far along the demo account's dataset is, for the
 * CALLER'S OWN session. The landing's "opening the demo" window polls it instead
 * of guessing from a spinner (that guess is what made a tester believe the app
 * was empty).
 *
 * Scoping, in order:
 *  1. AUTHENTICATED. Unlike `POST /session`, this is NOT in `PUBLIC_ROUTES` — an
 *     anonymous caller gets 401 from the gate before reaching here.
 *  2. DEMO ONLY. Anyone else gets 403, so this is not a general "is the server
 *     busy" oracle, and it can neither read nor affect another account.
 *  3. READ-ONLY AND SESSION-SCOPED. It answers about the caller's own
 *     `session_id` and returns no id, no email and no marker.
 *
 * It is also the single route `createDemoMiddleware` skips: polling it must never
 * trigger a seed, and must never queue behind the one it is watching.
 */
demoRouter.get('/status', async (c) => {
  const userId = requireUserId(c)
  if (!isDemoProfile(c.get('userProfile'), userId, resolveAuthConfig(process.env))) {
    throw new ForbiddenError('demo account only')
  }
  // Same marker derivation as the reset middleware — the two must agree or the
  // probe would report `pending` on an account the middleware considers seeded.
  const sessionId = c.get('authClaims')?.session_id
  const marker = typeof sessionId === 'string' ? sessionId : DEMO_NO_SESSION
  return ok(c, demoSeedStatusResponseSchema, await demoSeedStatus(db, userId, marker))
})
