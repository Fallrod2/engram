import type { MiddlewareHandler } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { resolveAuthConfig } from '../auth/config'
import { isDemoProfile } from '../services/profile.service'
import { readDemoMarker, seedDemo, DEMO_LOCK_KEY, DEMO_NO_SESSION } from '../services/demo.service'

/**
 * Demo-account reset middleware (spec §4). Mounted after the auth gate and before
 * the routers. When the authenticated user is the configured demo account and the
 * token's `session_id` differs from the last one we seeded, it wipes the demo
 * data and reseeds a fresh dataset — so each new demo login starts clean, but a
 * long session never re-wipes on every request.
 *
 * - Demo disabled (`ENGRAM_DEMO_USER_ID` unset) → pure no-op, no DB hit.
 * - No claims (e.g. `/api/health`, which returns before claims are set) → no-op.
 * - Token without a `session_id` (HS256 test tokens) → treated as marker
 *   `'no-session'`: seeded ONCE on the first pass, never re-wiped afterwards.
 * - Concurrency: the reset runs inside a transaction holding a constant advisory
 *   lock, and re-reads the marker under the lock, so two first-hits of the same
 *   new session can never double-seed. That lock (`DEMO_LOCK_KEY`, declared in
 *   the service) doubles as the in-flight signal read by `GET /api/demo/status`,
 *   which is why this middleware skips that one route entirely.
 */

/**
 * The ONE route this middleware must never seed on: `GET /api/demo/status`, the
 * probe the front polls while it waits. Exempting it is not a nicety, it is what
 * makes the probe a probe:
 *
 *  - if it seeded, polling would restart the very work it is meant to observe;
 *  - if it merely ran after the seed, it would block on the advisory lock and
 *    only ever answer `ready` — a progress indicator that reports nothing until
 *    there is nothing left to report.
 *
 * Exact and method-scoped, like `PUBLIC_ROUTES` in `auth.ts`, and NOT an auth
 * exemption: the route is still gated and still demo-only (see `routes/demo.ts`).
 */
const DEMO_STATUS_ROUTE = 'GET /api/demo/status'

export function createDemoMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    if (`${c.req.method} ${c.req.path}` === DEMO_STATUS_ROUTE) return next()

    const claims = c.get('authClaims')
    const sub = claims?.sub
    if (typeof sub !== 'string' || sub.length === 0) return next() // health / preflight

    // The demo account is resolved from the caller's own profile flag OR the env
    // id (spec §2.2 / amendment A8): setting `is_demo=true` from /admin activates
    // the reset + read-only behaviour without a redeploy. Non-demo → no-op.
    const cfg = resolveAuthConfig(process.env)
    if (!isDemoProfile(c.get('userProfile'), sub, cfg)) return next()
    const demoUserId = sub

    const sessionId = typeof claims.session_id === 'string' ? claims.session_id : null
    const marker = sessionId ?? DEMO_NO_SESSION

    // Fast path: already seeded for this session (one cheap read, no lock). The
    // marker lives under the demo user's own row `(demoUserId, 'demo')`.
    if ((await readDemoMarker(db, demoUserId)) === marker) return next()

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEMO_LOCK_KEY})`)
      // Re-check under the lock: a racing request may have just seeded.
      if ((await readDemoMarker(tx, demoUserId)) === marker) return
      await seedDemo(tx, demoUserId, marker)
    })
    return next()
  }
}
