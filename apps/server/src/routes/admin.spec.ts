import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { SignJWT } from 'jose'
import { eq } from 'drizzle-orm'
import { app } from '../app'
import { db } from '../db/client'
import { createTestDb } from '../db/test-db'
import { adminAudit, userProfile } from '../db/schema'
import {
  resetDb,
  seedCard,
  seedDeck,
  seedReviewLog,
  seedSubject,
  seedUserProfile,
} from '../test-support/harness'
import {
  deleteUser,
  listUsers,
  setDemo,
  setRole,
  setStatus,
  stats,
} from '../services/admin.service'
import { lockAdminGuard, resolveProfile } from '../services/profile.service'

/**
 * IAM / admin coverage (spec §5.1). Two layers:
 *  - SERVICE-level guard tests drive `admin.service` directly so a guard can be
 *    isolated from the route-level `requireAdmin` and from the env admin filet
 *    (which we control via env here).
 *  - ROUTE/MIDDLEWARE tests exercise `/api/me`, suspension enforcement and role
 *    resolution through `app.request`.
 */

const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
const ENV_KEYS = [
  'ENGRAM_ADMIN_USER_ID',
  'ENGRAM_DEMO_USER_ID',
  'ENGRAM_DEV_USER_ID',
  'SUPABASE_JWT_SECRET',
] as const
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = PREV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** Force enforced auth with NO env admin → the effective admin set is DB-only. */
function enforcedNoEnvAdmin() {
  process.env.SUPABASE_JWT_SECRET = SECRET
  delete process.env.ENGRAM_ADMIN_USER_ID
}

async function bearer(sub: string, email?: string): Promise<Record<string, string>> {
  const token = await new SignJWT({ role: 'authenticated', ...(email ? { email } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
  return { Authorization: `Bearer ${token}` }
}

const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

// --- Service guards --------------------------------------------------------

describe('admin.service — role guards', () => {
  it('blocks self-demote (actor === target)', async () => {
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    expect(setRole(db, 'admin-a', 'admin-a', 'user')).rejects.toThrow(/yourself/)
  })

  it('blocks demoting the last active admin (no env filet)', async () => {
    enforcedNoEnvAdmin()
    await seedUserProfile(db, { userId: 'sole-admin', role: 'admin' })
    // actor is a different id so the self-guard is not what fires.
    expect(setRole(db, 'other', 'sole-admin', 'user')).rejects.toThrow(/last active admin/)
  })

  it('allows demoting one of two admins, and audits it', async () => {
    enforcedNoEnvAdmin()
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    await seedUserProfile(db, { userId: 'admin-b', role: 'admin' })
    const res = await setRole(db, 'admin-a', 'admin-b', 'user')
    expect(res.role).toBe('user')
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, 'admin-b'))
    expect(audit!.action).toBe('role.demote')
    expect(audit!.details).toEqual({ from: 'admin', to: 'user' })
  })

  it('refuses to promote the demo account', async () => {
    await seedUserProfile(db, { userId: 'demo', isDemo: true })
    expect(setRole(db, 'admin-a', 'demo', 'admin')).rejects.toThrow(/demo/)
  })
})

describe('admin.service — last-admin guard is serialized by an advisory lock', () => {
  // The concurrency invariant: two admins demoting each other at once must not
  // both pass (→ zero admins). PGlite serializes transactions on one connection,
  // so it cannot exhibit the race — the REAL proof is `db/admin-guard-race.pgtest`.
  // Here we prove the two ingredients under PGlite: the lock IS requested, and
  // the guard recounts the effective admin set (so it sees committed state).
  it('lockAdminGuard issues a pg_advisory_xact_lock statement', async () => {
    const t = await createTestDb()
    try {
      const spy = spyOn(t.client, 'query')
      await lockAdminGuard(t.db)
      const requested = spy.mock.calls.some((c) => String(c[0]).includes('pg_advisory_xact_lock'))
      spy.mockRestore()
      expect(requested).toBe(true)
    } finally {
      await t.cleanup()
    }
  })

  it('recounts admins after the lock: demoting the now-sole admin is refused', async () => {
    enforcedNoEnvAdmin()
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    await seedUserProfile(db, { userId: 'admin-b', role: 'admin' })
    // First demote succeeds (two admins → one remains).
    await setRole(db, 'admin-a', 'admin-b', 'user')
    // The recount now sees a single admin → the second demote is blocked.
    await expect(setRole(db, 'admin-b', 'admin-a', 'user')).rejects.toThrow(/last active admin/)
  })
})

describe('admin.service — status guards', () => {
  it('blocks self-suspend', async () => {
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    expect(setStatus(db, 'admin-a', 'admin-a', 'suspended')).rejects.toThrow(/yourself/)
  })

  it('blocks suspending the last active admin', async () => {
    enforcedNoEnvAdmin()
    await seedUserProfile(db, { userId: 'sole-admin', role: 'admin' })
    expect(setStatus(db, 'other', 'sole-admin', 'suspended')).rejects.toThrow(/last active admin/)
  })

  it('suspends a normal user and audits it', async () => {
    await seedUserProfile(db, { userId: 'user-b' })
    const res = await setStatus(db, 'admin-a', 'user-b', 'suspended')
    expect(res.status).toBe('suspended')
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, 'user-b'))
    expect(audit!.action).toBe('status.suspend')
  })
})

describe('admin.service — demo guards + unicity', () => {
  it('refuses to make an admin the demo account', async () => {
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    expect(setDemo(db, 'root', 'admin-a', true)).rejects.toThrow(/admin/)
  })

  it('setting demo on B clears the previous demo A (single demo)', async () => {
    await seedUserProfile(db, { userId: 'demo-a', isDemo: true })
    await seedUserProfile(db, { userId: 'user-b' })
    const res = await setDemo(db, 'root', 'user-b', true)
    expect(res.isDemo).toBe(true)
    const [a] = await db.select().from(userProfile).where(eq(userProfile.userId, 'demo-a'))
    expect(a!.isDemo).toBe(false)
    // Exactly one demo remains.
    const demos = await db.select().from(userProfile).where(eq(userProfile.isDemo, true))
    expect(demos).toHaveLength(1)
    expect(demos[0]!.userId).toBe('user-b')
  })
})

describe('admin.service — delete (GDPR)', () => {
  it('wipes all user data + profile, reports authDeleted:false on PGlite, and audits counts', async () => {
    await seedUserProfile(db, { userId: 'victim' })
    const s = await seedSubject(db, { userId: 'victim' })
    const d = await seedDeck(db, s.id, { userId: 'victim' })
    const c = await seedCard(db, d.id, { userId: 'victim' })
    await seedReviewLog(db, c.id, { userId: 'victim' })

    const res = await deleteUser(db, 'admin-a', 'victim')
    expect(res.authDeleted).toBe(false) // no auth schema on PGlite
    expect(res.deletedCounts.subjects).toBe(1)
    expect(res.deletedCounts.cards).toBe(1)
    expect(res.deletedCounts.reviewLogs).toBe(1)

    const [gone] = await db.select().from(userProfile).where(eq(userProfile.userId, 'victim'))
    expect(gone).toBeUndefined()
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, 'victim'))
    expect(audit!.action).toBe('user.delete')
  })

  it('blocks self-delete', async () => {
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    expect(deleteUser(db, 'admin-a', 'admin-a')).rejects.toThrow(/yourself/)
  })

  it('blocks deleting the last active admin', async () => {
    enforcedNoEnvAdmin()
    await seedUserProfile(db, { userId: 'sole-admin', role: 'admin' })
    expect(deleteUser(db, 'other', 'sole-admin')).rejects.toThrow(/last active admin/)
  })

  it('blocks deleting the active demo without unsetting the flag', async () => {
    await seedUserProfile(db, { userId: 'demo', isDemo: true })
    expect(deleteUser(db, 'admin-a', 'demo')).rejects.toThrow(/demo/)
  })
})

describe('admin.service — audit is PII-free', () => {
  it('never stores an email in details', async () => {
    await seedUserProfile(db, { userId: 'user-b', email: 'b@example.com' })
    await setStatus(db, 'admin-a', 'user-b', 'suspended')
    const [audit] = await db.select().from(adminAudit)
    expect(JSON.stringify(audit!.details)).not.toContain('@')
  })
})

describe('admin.service — list + stats multi-user', () => {
  it('aggregates usage per user and paginates', async () => {
    await seedUserProfile(db, { userId: 'u1', email: 'u1@x.io' })
    await seedUserProfile(db, { userId: 'u2', email: 'u2@x.io' })
    const s = await seedSubject(db, { userId: 'u1' })
    const d = await seedDeck(db, s.id, { userId: 'u1' })
    await seedCard(db, d.id, { userId: 'u1' })
    await seedCard(db, d.id, { userId: 'u1' })

    const res = await listUsers(db, { page: 1, sort: 'cards', dir: 'desc' })
    expect(res.total).toBe(2)
    expect(res.users[0]!.userId).toBe('u1')
    expect(res.users[0]!.cards).toBe(2)
    expect(res.users[0]!.subjects).toBe(1)
    // Aggregates are SCOPED PER USER: u2 owns nothing (regression guard for the
    // correlated-subquery bug where every row showed the global card count).
    expect(res.users[1]!.userId).toBe('u2')
    expect(res.users[1]!.cards).toBe(0)
    expect(res.users[1]!.subjects).toBe(0)
  })

  it('search matches on email (LIKE metacharacters escaped)', async () => {
    await seedUserProfile(db, { userId: 'u1', email: 'alice@x.io' })
    await seedUserProfile(db, { userId: 'u2', email: 'bob@x.io' })
    const res = await listUsers(db, { query: 'alice', page: 1, sort: 'lastSeen', dir: 'desc' })
    expect(res.total).toBe(1)
    expect(res.users[0]!.email).toBe('alice@x.io')
    // A literal % must NOT act as a wildcard (escaped) → no match.
    const none = await listUsers(db, { query: '%', page: 1, sort: 'lastSeen', dir: 'desc' })
    expect(none.total).toBe(0)
  })

  it('stats reports totals, suspended and admins', async () => {
    await seedUserProfile(db, { userId: 'a', role: 'admin' })
    await seedUserProfile(db, { userId: 'b' })
    await seedUserProfile(db, { userId: 'c', status: 'suspended' })
    const res = await stats(db)
    expect(res.totals.users).toBe(3)
    expect(res.totals.admins).toBe(1)
    expect(res.totals.suspended).toBe(1)
    expect(res.signupsPerDay).toHaveLength(30)
    expect(res.generationsPerDay).toHaveLength(30)
  })
})

// --- Profile middleware + /api/me + suspension -----------------------------

describe('profile middleware — lazy upsert + throttle', () => {
  it('creates a profile on first authenticated request (role user)', async () => {
    // Bypass mode (no auth env) → identity is dev-user.
    await req('/api/subjects')
    const [row] = await db.select().from(userProfile).where(eq(userProfile.userId, 'dev-user'))
    expect(row!.role).toBe('user')
  })

  it('does not write again while fresh (throttle: last_seen_at unchanged)', async () => {
    const p1 = await resolveProfile(db, 'u-fresh', 'u@x.io')
    const [before] = await db.select().from(userProfile).where(eq(userProfile.userId, 'u-fresh'))
    // A second resolve within the throttle window must not bump last_seen_at.
    await resolveProfile(db, 'u-fresh', 'u@x.io')
    const [after] = await db.select().from(userProfile).where(eq(userProfile.userId, 'u-fresh'))
    expect(after!.lastSeenAt.getTime()).toBe(before!.lastSeenAt.getTime())
    expect(p1.email).toBe('u@x.io')
  })

  it('never overwrites a stored email with NULL', async () => {
    await resolveProfile(db, 'u-mail', 'keep@x.io')
    // A later token with no email claim (and a stale last_seen) must keep it.
    await db
      .update(userProfile)
      .set({ lastSeenAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(userProfile.userId, 'u-mail'))
    await resolveProfile(db, 'u-mail', null)
    const [row] = await db.select().from(userProfile).where(eq(userProfile.userId, 'u-mail'))
    expect(row!.email).toBe('keep@x.io')
  })
})

describe('GET /api/me', () => {
  it('returns the identity (dev bypass → admin via filet)', async () => {
    const res = await req('/api/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string; isAdmin: boolean; status: string }
    expect(body.userId).toBe('dev-user')
    expect(body.isAdmin).toBe(true)
    expect(body.status).toBe('active')
  })
})

describe('suspension enforcement', () => {
  it('a suspended user gets 403 suspended on a normal route but 200 on /api/me', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET // enforced
    await seedUserProfile(db, { userId: 'susp', status: 'suspended' })
    const h = await bearer('susp')

    const blocked = await req('/api/subjects', 'GET', undefined, h)
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('suspended')

    const me = await req('/api/me', 'GET', undefined, h)
    expect(me.status).toBe(200)
    expect(((await me.json()) as { status: string }).status).toBe('suspended')
  })

  it('the env admin is never blocked even if suspended in the DB (anti-lockout)', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    process.env.ENGRAM_ADMIN_USER_ID = 'env-admin'
    await seedUserProfile(db, { userId: 'env-admin', role: 'admin', status: 'suspended' })
    const h = await bearer('env-admin')
    const res = await req('/api/admin/users', 'GET', undefined, h)
    expect(res.status).toBe(200)
  })
})

describe('role resolution via DB (backup stays admin-only, no env)', () => {
  it('a user promoted to admin in the DB reaches an admin route WITHOUT env', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    delete process.env.ENGRAM_ADMIN_USER_ID
    await seedUserProfile(db, { userId: 'promoted', role: 'admin' })
    const h = await bearer('promoted')
    expect((await req('/api/admin/users', 'GET', undefined, h)).status).toBe(200)
    // A non-admin (enforced, no env, role user) → 403 forbidden.
    await seedUserProfile(db, { userId: 'plain' })
    const h2 = await bearer('plain')
    const res = await req('/api/admin/users', 'GET', undefined, h2)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden')
  })
})

describe('admin routes — end to end (bypass admin)', () => {
  it('promote → audit visible in /api/admin/audit', async () => {
    await seedUserProfile(db, { userId: 'target' })
    const patch = await req('/api/admin/users/target/role', 'PATCH', { role: 'admin' })
    expect(patch.status).toBe(200)
    const audit = await req('/api/admin/audit')
    const body = (await audit.json()) as { entries: { action: string; targetUserId: string }[] }
    expect(
      body.entries.some((e) => e.action === 'role.promote' && e.targetUserId === 'target'),
    ).toBe(true)
  })
})
