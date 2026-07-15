import { and, eq, inArray, sql } from 'drizzle-orm'
import type { UserRole, UserStatus } from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { userProfile } from '../db/schema'
import { resolveAdminUserId, type AuthConfig } from '../auth/config'

/**
 * The IAM profile resolution layer (spec §2, amendments A1/A2). Everything the
 * per-request middleware and the admin guards need to answer "who is this, and
 * what may they do" lives here — as pure-ish DB helpers, never a module-level
 * cache. Suspension and role changes are therefore effective at the VERY NEXT
 * request (zero staleness window): the middleware reads the row every time.
 */

/** The decision-relevant slice of a profile, carried in the request context. */
export interface RequestProfile {
  userId: string
  email: string | null
  role: UserRole
  status: UserStatus
  isDemo: boolean
}

/** How stale `last_seen_at` may be before the throttled touch writes (5 min). */
const TOUCH_THROTTLE_MS = 5 * 60_000

function normalize(row: {
  userId: string
  email: string | null
  role: string
  status: string
  isDemo: boolean
}): RequestProfile {
  return {
    userId: row.userId,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'suspended' ? 'suspended' : 'active',
    isDemo: row.isDemo,
  }
}

/**
 * Read-then-throttled-touch the profile (amendment A2). ALWAYS reads (one PK
 * SELECT), so a suspension/role change lands on the next request. Writes ONLY
 * when absent or stale, via a single race-safe `INSERT … ON CONFLICT DO UPDATE`
 * (two concurrent first-hits of the same user never 500 nor double-insert). The
 * COALESCE never overwrites a stored email with NULL when the token omits the
 * claim; role/status/is_demo are never touched here (admin writes own those).
 */
export async function resolveProfile(
  db: DB,
  userId: string,
  emailClaim: string | null,
): Promise<RequestProfile> {
  const [existing] = await db
    .select({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
      lastSeenAt: userProfile.lastSeenAt,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))

  const emailChanged = emailClaim !== null && existing?.email !== emailClaim
  const stale =
    !existing || emailChanged || Date.now() - existing.lastSeenAt.getTime() > TOUCH_THROTTLE_MS

  if (!stale) return normalize(existing)

  const now = new Date()
  const [row] = await db
    .insert(userProfile)
    .values({ userId, email: emailClaim, lastSeenAt: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: userProfile.userId,
      set: {
        lastSeenAt: now,
        updatedAt: now,
        // Never clobber a stored email with NULL (COALESCE keeps the existing one).
        email: sql`coalesce(${emailClaim}, ${userProfile.email})`,
      },
    })
    .returning({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
    })
  return normalize(row!)
}

/**
 * Is this user an admin? Profile role OR the permanent env filet (amendment A4):
 * the `ENGRAM_ADMIN_USER_ID` (or the dev identity under bypass) is ALWAYS admin,
 * even if the DB is corrupt or their row was deleted. Pure over an already-read
 * profile — stays sync, so `requireAdmin` never becomes async (amendment A1).
 */
export function isAdminProfile(
  profile: RequestProfile | undefined,
  userId: string,
  cfg: AuthConfig,
): boolean {
  if (profile?.role === 'admin') return true
  return userId === resolveAdminUserId(cfg)
}

/** Is this user the demo account? Profile flag OR the env demo id (spec §2.2). */
export function isDemoProfile(
  profile: RequestProfile | undefined,
  userId: string,
  cfg: AuthConfig,
): boolean {
  if (profile?.isDemo) return true
  return cfg.demoUserId !== undefined && userId === cfg.demoUserId
}

/**
 * The set of EFFECTIVE active-admin user ids (amendments A4/A5): every DB row
 * with role='admin' AND status='active', UNION the env admin id (always an
 * effective active admin — it can be neither suspended nor demoted in effect).
 * Drives the last-admin guards for demote / suspend / delete.
 */
export async function effectiveActiveAdminIds(db: DB | Tx, cfg: AuthConfig): Promise<Set<string>> {
  const rows = await db
    .select({ userId: userProfile.userId })
    .from(userProfile)
    .where(and(eq(userProfile.role, 'admin'), eq(userProfile.status, 'active')))
  const set = new Set(rows.map((r) => r.userId))
  const envAdmin = resolveAdminUserId(cfg)
  if (envAdmin) set.add(envAdmin)
  return set
}

/** Would removing `targetUserId` from the effective active-admin set empty it? */
export async function wouldBeLastActiveAdmin(
  db: DB | Tx,
  cfg: AuthConfig,
  targetUserId: string,
): Promise<boolean> {
  const set = await effectiveActiveAdminIds(db, cfg)
  set.delete(targetUserId)
  return set.size === 0
}

/**
 * Constant key serializing the admin-invariant write paths (demote / suspend /
 * delete of an admin) under one transaction-scoped advisory lock — the same
 * mechanism `http/demo.ts` uses to serialize the demo reset. Any distinct
 * constant works; every guarded write must share THIS one so they serialize.
 */
export const ADMIN_GUARD_LOCK_KEY = 728461

/**
 * Take the shared advisory lock BEFORE recounting the effective active-admin set,
 * so the "last admin" guard sees committed state (amendment: the last-admin
 * invariant, unlike the demo singleton, has no DB constraint backing it).
 *
 * Without it, two admins demoting each other concurrently each read a 2-admin set
 * before the other commits, both pass, and the set empties → total lockout. The
 * lock (`pg_advisory_xact_lock`, released at commit/rollback) forces the second
 * writer to block until the first commits, then recount the fresh state. PGlite
 * accepts the call (it already runs in demo.ts) but serializes transactions
 * anyway; the REAL concurrency proof lives in `db/admin-guard-race.pgtest.ts`.
 *
 * Accepts `DB | Tx` so a unit test can drive it against the top-level handle (and
 * observe the emitted statement); production callers always pass a real `Tx`, so
 * the lock is transaction-scoped and released on commit/rollback.
 */
export async function lockAdminGuard(tx: DB | Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_GUARD_LOCK_KEY})`)
}

/** Read a single profile row (admin detail / mutation echo), or undefined. */
export async function getProfile(db: DB | Tx, userId: string): Promise<RequestProfile | undefined> {
  const [row] = await db
    .select({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
    })
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
  return row ? normalize(row) : undefined
}

/** Read many profiles by id (for resolving audit actor/target emails at read). */
export async function getEmailsByIds(
  db: DB | Tx,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ userId: userProfile.userId, email: userProfile.email })
    .from(userProfile)
    .where(inArray(userProfile.userId, ids))
  return new Map(rows.map((r) => [r.userId, r.email]))
}
