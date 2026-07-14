import type { MiddlewareHandler } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { resolveAuthConfig } from '../auth/config'
import { isDemoProfile } from '../services/profile.service'
import { readDemoMarker, seedDemo, DEMO_NO_SESSION } from '../services/demo.service'

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
 *   new session can never double-seed.
 */

/** Constant key for `pg_advisory_xact_lock` guarding the demo reset. */
const DEMO_LOCK_KEY = 918273

export function createDemoMiddleware(): MiddlewareHandler {
  return async (c, next) => {
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
