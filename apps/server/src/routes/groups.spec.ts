import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { SignJWT } from 'jose'
import { eq } from 'drizzle-orm'
import {
  ADMIN_PERMISSIONS,
  type AdminGroup,
  type AdminGroupMembersResponse,
  type AdminGroupsResponse,
  type MeResponse,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { createTestDb } from '../db/test-db'
import { groupMember, groupPermission, userProfile } from '../db/schema'
import {
  resetDb,
  seedGroup,
  seedGroupMember,
  seedGroupPermission,
  seedUserProfile,
} from '../test-support/harness'
import { deleteUser, listAudit } from '../services/admin.service'
import { resolveProfile } from '../services/profile.service'

/**
 * RBAC groups / delegated administration coverage (rbac-groups §6, amendment H).
 * Route-layer tests drive the real middleware (profile resolution → folded
 * permissions → requirePermission) via `app.request` with an HS256 bearer, so a
 * distinct `sub` is a distinct user whose profile is created lazily.
 */

const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
const ENV_KEYS = ['ENGRAM_ADMIN_USER_ID', 'ENGRAM_DEV_USER_ID', 'SUPABASE_JWT_SECRET'] as const
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  await resetDb(db)
  // Enforced auth, NO env admin → the effective permission set is DB-only.
  process.env.SUPABASE_JWT_SECRET = SECRET
  delete process.env.ENGRAM_ADMIN_USER_ID
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = PREV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

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

/** Read a response body as a typed DTO (route responses are contract-validated). */
const jsonOf = async <T>(res: Response): Promise<T> => (await res.json()) as T

// --- Permission resolution (folded subquery) -------------------------------

describe('permission resolution — /api/me', () => {
  it('admin ⇒ ALL permissions', async () => {
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
    const res = await req('/api/me', 'GET', undefined, await bearer('admin-1'))
    expect(res.status).toBe(200)
    const me = await jsonOf<MeResponse>(res)
    expect(me.isAdmin).toBe(true)
    expect([...me.permissions].sort()).toEqual([...ADMIN_PERMISSIONS].sort())
  })

  it('env-admin ⇒ ALL permissions even with a user DB role', async () => {
    process.env.ENGRAM_ADMIN_USER_ID = 'env-admin'
    await seedUserProfile(db, { userId: 'env-admin', role: 'user' })
    const res = await req('/api/me', 'GET', undefined, await bearer('env-admin'))
    const me = await jsonOf<MeResponse>(res)
    expect(me.isAdmin).toBe(true)
    expect([...me.permissions].sort()).toEqual([...ADMIN_PERMISSIONS].sort())
  })

  it('user with 2 groups ⇒ DISTINCT union of their permissions', async () => {
    await seedUserProfile(db, { userId: 'mod-1' })
    const g1 = await seedGroup(db, { name: 'A' })
    const g2 = await seedGroup(db, { name: 'B' })
    await seedGroupMember(db, g1.id, 'mod-1')
    await seedGroupMember(db, g2.id, 'mod-1')
    await seedGroupPermission(db, g1.id, 'users.view')
    await seedGroupPermission(db, g1.id, 'users.manage')
    await seedGroupPermission(db, g2.id, 'users.view') // overlap → deduped
    await seedGroupPermission(db, g2.id, 'audit.view')
    const res = await req('/api/me', 'GET', undefined, await bearer('mod-1'))
    const me = await jsonOf<MeResponse>(res)
    expect(me.isAdmin).toBe(false)
    expect([...me.permissions].sort()).toEqual(['audit.view', 'users.manage', 'users.view'])
  })

  it('user with no group ⇒ empty; brand-new user ⇒ empty', async () => {
    await seedUserProfile(db, { userId: 'plain' })
    const r1 = await req('/api/me', 'GET', undefined, await bearer('plain'))
    expect((await jsonOf<MeResponse>(r1)).permissions).toEqual([])
    // 'fresh' has no profile row yet — created lazily, no groups.
    const r2 = await req('/api/me', 'GET', undefined, await bearer('fresh'))
    expect((await jsonOf<MeResponse>(r2)).permissions).toEqual([])
  })
})

// --- requirePermission mapping (amendments A1/A2/A5) ------------------------

describe('route → permission mapping', () => {
  async function seedMod(sub: string, perms: (typeof ADMIN_PERMISSIONS)[number][]) {
    await seedUserProfile(db, { userId: sub })
    const g = await seedGroup(db, { name: `grp-${sub}` })
    await seedGroupMember(db, g.id, sub)
    for (const p of perms) await seedGroupPermission(db, g.id, p)
    return g
  }

  it('{users.view} can GET /users but NOT PATCH /status', async () => {
    await seedMod('viewer', ['users.view'])
    await seedUserProfile(db, { userId: 'target' })
    const list = await req('/api/admin/users', 'GET', undefined, await bearer('viewer'))
    expect(list.status).toBe(200)
    const suspend = await req(
      '/api/admin/users/target/status',
      'PATCH',
      { status: 'suspended' },
      await bearer('viewer'),
    )
    expect(suspend.status).toBe(403)
  })

  it('{users.manage} can suspend but NOT promote (role stays requireAdmin, A1)', async () => {
    // An admin must exist so the last-active-admin guard does not block suspending
    // an unrelated user (the guard trips when the admin set would be empty).
    await seedUserProfile(db, { userId: 'boss', role: 'admin' })
    await seedMod('manager', ['users.manage'])
    await seedUserProfile(db, { userId: 'victim' })
    const suspend = await req(
      '/api/admin/users/victim/status',
      'PATCH',
      { status: 'suspended' },
      await bearer('manager'),
    )
    expect(suspend.status).toBe(200)
    const promote = await req(
      '/api/admin/users/victim/role',
      'PATCH',
      { role: 'admin' },
      await bearer('manager'),
    )
    expect(promote.status).toBe(403)
  })

  it('{groups.manage} non-admin can create a group but NOT set its permissions (A2)', async () => {
    const g = await seedMod('gmanager', ['groups.manage'])
    const create = await req(
      '/api/admin/groups',
      'POST',
      { name: 'Fresh' },
      await bearer('gmanager'),
    )
    expect(create.status).toBe(201)
    const setPerms = await req(
      `/api/admin/groups/${g.id}/permissions`,
      'PUT',
      { permissions: ['users.manage'] },
      await bearer('gmanager'),
    )
    expect(setPerms.status).toBe(403) // requireAdmin — the escalation frontier
  })

  it('a user with no permission is refused /admin/users (403)', async () => {
    await seedUserProfile(db, { userId: 'nobody' })
    const res = await req('/api/admin/users', 'GET', undefined, await bearer('nobody'))
    expect(res.status).toBe(403)
  })
})

// --- Groups CRUD + members (admin path) ------------------------------------

describe('groups CRUD + members (admin)', () => {
  const admin = () => bearer('admin-1')
  beforeEach(async () => {
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
  })

  it('create → list → set permissions → add/remove member → delete', async () => {
    const created = await jsonOf<AdminGroup>(
      await req('/api/admin/groups', 'POST', { name: 'Mods' }, await admin()),
    )
    expect(created.name).toBe('Mods')
    expect(created.permissions).toEqual([])

    const setPerms = await req(
      `/api/admin/groups/${created.id}/permissions`,
      'PUT',
      { permissions: ['users.view', 'users.manage', 'users.view'] },
      await admin(),
    )
    expect(setPerms.status).toBe(200)
    expect((await jsonOf<AdminGroup>(setPerms)).permissions).toEqual(['users.manage', 'users.view'])

    await seedUserProfile(db, { userId: 'member-x', email: 'x@e.co' })
    const added = await req(
      `/api/admin/groups/${created.id}/members`,
      'POST',
      { userId: 'member-x' },
      await admin(),
    )
    expect(added.status).toBe(200)
    expect((await jsonOf<AdminGroupMembersResponse>(added)).members).toEqual([
      { userId: 'member-x', email: 'x@e.co' },
    ])

    const list = await jsonOf<AdminGroupsResponse>(
      await req('/api/admin/groups', 'GET', undefined, await admin()),
    )
    expect(list.groups[0]!.memberCount).toBe(1)

    const removed = await req(
      `/api/admin/groups/${created.id}/members/member-x`,
      'DELETE',
      undefined,
      await admin(),
    )
    expect((await jsonOf<AdminGroupMembersResponse>(removed)).members).toEqual([])

    const del = await req(`/api/admin/groups/${created.id}`, 'DELETE', undefined, await admin())
    expect((await jsonOf<{ deleted: boolean }>(del)).deleted).toBe(true)
    const after = await jsonOf<AdminGroupsResponse>(
      await req('/api/admin/groups', 'GET', undefined, await admin()),
    )
    expect(after.groups).toEqual([])
  })

  it('rejects a duplicate name case-insensitively (409)', async () => {
    await req('/api/admin/groups', 'POST', { name: 'Support' }, await admin())
    const dup = await req('/api/admin/groups', 'POST', { name: 'support' }, await admin())
    expect(dup.status).toBe(409)
  })
})

// --- Last-admin guard independence + deleteUser purge ----------------------

describe('safety invariants', () => {
  it('groups never touch role: the last admin stays protected', async () => {
    await seedUserProfile(db, { userId: 'sole-admin', role: 'admin' })
    // Give the sole admin a group with every permission — role is unaffected.
    const g = await seedGroup(db, { name: 'All' })
    await seedGroupMember(db, g.id, 'sole-admin')
    for (const p of ADMIN_PERMISSIONS) await seedGroupPermission(db, g.id, p)
    // Demoting the sole admin is still refused (role='admin' remains sovereign).
    const res = await req(
      '/api/admin/users/sole-admin/role',
      'PATCH',
      { role: 'user' },
      await bearer('sole-admin'),
    )
    expect(res.status).toBe(403) // self-demote guard fires first, admin unchanged
  })

  it('deleteUser purges the user group memberships (E1)', async () => {
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
    await seedUserProfile(db, { userId: 'doomed' })
    const g = await seedGroup(db, { name: 'Team' })
    await seedGroupMember(db, g.id, 'doomed')
    await deleteUser(db, 'admin-1', 'doomed')
    const left = await db.select().from(groupMember).where(eq(groupMember.userId, 'doomed'))
    expect(left).toEqual([])
  })
})

// --- Audit non-regression (amendment B1) -----------------------------------

describe('audit journal', () => {
  it('a group.* action is listable without a 500 (enum extended)', async () => {
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
    await req('/api/admin/groups', 'POST', { name: 'Audited' }, await bearer('admin-1'))
    // The service wrote a `group.create` row — reading it must NOT throw.
    const res = await listAudit(db, 1)
    expect(res.entries.some((e) => e.action === 'group.create')).toBe(true)
    // And the HTTP audit route validates every row against the schema.
    const http = await req('/api/admin/audit', 'GET', undefined, await bearer('admin-1'))
    expect(http.status).toBe(200)
  })
})

// --- CHECK constraint mirrors ADMIN_PERMISSIONS (amendment D2) --------------

describe('group_permission CHECK mirrors ADMIN_PERMISSIONS', () => {
  it('accepts every ADMIN_PERMISSIONS value and rejects a bogus one', async () => {
    const g = await seedGroup(db, { name: 'CheckGrp' })
    for (const p of ADMIN_PERMISSIONS) {
      await db.insert(groupPermission).values({ groupId: g.id, permission: p })
    }
    let threw = false
    try {
      await db.insert(groupPermission).values({ groupId: g.id, permission: 'bogus.perm' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// --- Resolution efficiency (amendment C1/H9) -------------------------------

describe('resolution efficiency', () => {
  it('a fresh profile resolves in ONE query with permissions folded in', async () => {
    const t = await createTestDb()
    try {
      // lastSeenAt = now → non-stale → only the SELECT runs (no touch upsert).
      await t.db.insert(userProfile).values({ userId: 'u1', lastSeenAt: new Date() })
      const spy = spyOn(t.client, 'query')
      const p = await resolveProfile(t.db, 'u1', null)
      const calls = spy.mock.calls.map((c) => String(c[0]).toLowerCase())
      spy.mockRestore()
      expect(p.permissions.size).toBe(0)
      const profileReads = calls.filter((c) => c.includes('user_profile'))
      // Exactly one round-trip, and the permission union is folded INTO it — not a
      // separate `select ... from group_member` query (no extra round-trip).
      expect(profileReads.length).toBe(1)
      expect(profileReads[0]).toContain('group_member')
      const standaloneGroupReads = calls.filter(
        (c) => c.includes('group_member') && !c.includes('user_profile'),
      )
      expect(standaloneGroupReads.length).toBe(0)
    } finally {
      await t.cleanup()
    }
  })
})
