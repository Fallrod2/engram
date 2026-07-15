import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SignJWT } from 'jose'
import { eq } from 'drizzle-orm'
import type { AdminUserSummary } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { adminAudit, groupMember, userProfile } from '../db/schema'
import {
  resetDb,
  seedGroup,
  seedGroupMember,
  seedGroupPermission,
  seedUserProfile,
} from '../test-support/harness'
import {
  __setAdminAuthClientForTests,
  AdminAuthError,
  type AdminAuthClient,
} from '../auth/admin-client'

/**
 * Account CRUD via the GoTrue Admin API (spec §4). The admin client is INJECTED
 * and MOCKED — no test ever touches real GoTrue (recon §6). We assert:
 *  - both create modes hit the mock + write the profile/groups/audit,
 *  - the temporary password + the service_role NEVER appear in a response/audit,
 *  - the gate is incontournable (role=admin ⇒ requireAdmin; groupIds ⇒ groups.manage),
 *  - a clean 503 when account management is unconfigured (no crash),
 *  - GoTrue "email taken" → 409, a non-uuid sub → 502 (no profile written).
 */

const NEW_SUB = '11111111-1111-4111-8111-111111111111'
const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
const ENV_KEYS = [
  'ENGRAM_ADMIN_USER_ID',
  'ENGRAM_DEV_USER_ID',
  'SUPABASE_JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENGRAM_PUBLIC_SITE_URL',
] as const
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  __setAdminAuthClientForTests(undefined)
  for (const k of ENV_KEYS) {
    const v = PREV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** Enforced auth, DB-only permissions (no env admin) — mirrors groups.spec. */
function enforced() {
  process.env.SUPABASE_JWT_SECRET = SECRET
  delete process.env.ENGRAM_ADMIN_USER_ID
}

async function bearer(sub: string): Promise<Record<string, string>> {
  const token = await new SignJWT({ role: 'authenticated' })
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

interface MockCalls {
  invite: { email: string; redirectTo: string }[]
  create: { email: string; password: string; emailConfirm: boolean }[]
  updateEmail: { id: string; email: string }[]
}

/** A recording mock admin client. Overrides let a test force an error / bad sub. */
function mockClient(overrides: Partial<AdminAuthClient> = {}) {
  const calls: MockCalls = { invite: [], create: [], updateEmail: [] }
  const base: AdminAuthClient = {
    async inviteUser(email, redirectTo) {
      calls.invite.push({ email, redirectTo })
      return { id: NEW_SUB }
    },
    async createUser(input) {
      calls.create.push(input)
      return { id: NEW_SUB }
    },
    async updateUserEmail(id, email) {
      calls.updateEmail.push({ id, email })
      return { id }
    },
  }
  const client: AdminAuthClient = { ...base, ...overrides }
  __setAdminAuthClientForTests(client)
  return { client, calls }
}

// --- Create: invite mode (bypass admin) ------------------------------------

describe('POST /api/admin/users — invite mode', () => {
  it('calls inviteUser, creates the profile, links groups, audits user.create', async () => {
    const { calls } = mockClient()
    const g = await seedGroup(db, { name: 'Team' })
    const res = await req('/api/admin/users', 'POST', {
      mode: 'invite',
      email: 'newbie@x.io',
      groupIds: [g.id],
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as AdminUserSummary
    expect(body.userId).toBe(NEW_SUB)
    expect(body.email).toBe('newbie@x.io')
    expect(body.role).toBe('user')

    // GoTrue mock hit exactly once, with a SERVER-derived redirect (never Origin).
    expect(calls.invite).toHaveLength(1)
    expect(calls.invite[0]!.email).toBe('newbie@x.io')
    expect(calls.invite[0]!.redirectTo).toBe('http://localhost:5174/')

    const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, NEW_SUB))
    expect(profile!.email).toBe('newbie@x.io')
    const members = await db.select().from(groupMember).where(eq(groupMember.userId, NEW_SUB))
    expect(members).toHaveLength(1)
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, NEW_SUB))
    expect(audit!.action).toBe('user.create')
    expect(audit!.details).toMatchObject({ mode: 'invite', role: 'user' })
  })

  it('honours ENGRAM_PUBLIC_SITE_URL for the redirect (A9)', async () => {
    process.env.ENGRAM_PUBLIC_SITE_URL = 'https://engram.example.com'
    const { calls } = mockClient()
    await req('/api/admin/users', 'POST', { mode: 'invite', email: 'a@x.io' })
    expect(calls.invite[0]!.redirectTo).toBe('https://engram.example.com/')
  })
})

// --- Create: password mode — secret never leaks ----------------------------

describe('POST /api/admin/users — password mode', () => {
  it('sends the password to GoTrue but never to the response or audit (A10)', async () => {
    const { calls } = mockClient()
    const PW = 'sup3rSecretTemp'
    const res = await req('/api/admin/users', 'POST', {
      mode: 'password',
      email: 'temp@x.io',
      password: PW,
    })
    expect(res.status).toBe(201)
    const raw = await res.text()
    // The password reached GoTrue (email_confirm true) …
    expect(calls.create).toHaveLength(1)
    expect(calls.create[0]!.password).toBe(PW)
    expect(calls.create[0]!.emailConfirm).toBe(true)
    // … but is absent from the response body …
    expect(raw).not.toContain(PW)
    // … and from the audit row (details + any column).
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, NEW_SUB))
    expect(JSON.stringify(audit!.details)).not.toContain(PW)
    // No `password` KEY in details (the `mode` VALUE is legitimately 'password').
    expect(Object.keys(audit!.details as Record<string, unknown>)).not.toContain('password')
  })
})

// --- Gate: role=admin ⇒ requireAdmin (A2) ----------------------------------

describe('POST /api/admin/users — gate is incontournable', () => {
  it('a users.manage delegate creating role=admin is refused 403, no GoTrue call', async () => {
    enforced()
    await seedUserProfile(db, { userId: 'boss', role: 'admin' }) // keep an admin around
    await seedUserProfile(db, { userId: 'manager' })
    const g = await seedGroup(db, { name: 'M' })
    await seedGroupMember(db, g.id, 'manager')
    await seedGroupPermission(db, g.id, 'users.manage')
    const { calls } = mockClient()

    const res = await req(
      '/api/admin/users',
      'POST',
      { mode: 'invite', email: 'evil@x.io', role: 'admin' },
      await bearer('manager'),
    )
    expect(res.status).toBe(403)
    expect(calls.invite).toHaveLength(0)
    expect(calls.create).toHaveLength(0)
    const audits = await db.select().from(adminAudit).where(eq(adminAudit.action, 'user.create'))
    expect(audits).toHaveLength(0)
  })

  it('groupIds requires groups.manage too — a users.manage-only delegate is 403 (A1)', async () => {
    enforced()
    await seedUserProfile(db, { userId: 'manager' })
    const grp = await seedGroup(db, { name: 'Powerful' })
    const mgrGrp = await seedGroup(db, { name: 'Mgr' })
    await seedGroupMember(db, mgrGrp.id, 'manager')
    await seedGroupPermission(db, mgrGrp.id, 'users.manage')
    const { calls } = mockClient()

    const res = await req(
      '/api/admin/users',
      'POST',
      { mode: 'invite', email: 'x@x.io', groupIds: [grp.id] },
      await bearer('manager'),
    )
    expect(res.status).toBe(403)
    expect(calls.invite).toHaveLength(0)
  })

  it('an admin CAN create another admin', async () => {
    // Bypass mode → dev-user is admin via the env filet.
    mockClient()
    const res = await req('/api/admin/users', 'POST', {
      mode: 'invite',
      email: 'admin2@x.io',
      role: 'admin',
    })
    expect(res.status).toBe(201)
    const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, NEW_SUB))
    expect(profile!.role).toBe('admin')
  })
})

// --- GoTrue errors mapped -------------------------------------------------

describe('POST /api/admin/users — upstream errors', () => {
  it('email already registered → 409 email_taken', async () => {
    mockClient({
      async inviteUser() {
        throw new AdminAuthError('email_taken', 422, 'email already registered')
      },
    })
    const res = await req('/api/admin/users', 'POST', { mode: 'invite', email: 'taken@x.io' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('email_taken')
  })

  it('a non-uuid sub from GoTrue → 502, no profile written (A7)', async () => {
    mockClient({
      async inviteUser() {
        return { id: 'not-a-uuid' }
      },
    })
    const res = await req('/api/admin/users', 'POST', { mode: 'invite', email: 'weird@x.io' })
    expect(res.status).toBe(502)
    const rows = await db.select().from(userProfile).where(eq(userProfile.userId, 'not-a-uuid'))
    expect(rows).toHaveLength(0)
  })
})

// --- 503 when unconfigured (no crash) --------------------------------------

describe('account management unavailable', () => {
  it('POST /users → 503 account_mgmt_unavailable when no service_role (no override)', async () => {
    enforced() // enforced auth, but NO override + no SUPABASE_URL/service_role
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
    const res = await req(
      '/api/admin/users',
      'POST',
      { mode: 'invite', email: 'a@x.io' },
      await bearer('admin-1'),
    )
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'account_mgmt_unavailable',
    )
  })

  it('PATCH email → 503 when unconfigured', async () => {
    enforced()
    await seedUserProfile(db, { userId: 'admin-1', role: 'admin' })
    await seedUserProfile(db, { userId: 'victim', email: 'old@x.io' })
    const res = await req(
      '/api/admin/users/victim',
      'PATCH',
      { email: 'new@x.io' },
      await bearer('admin-1'),
    )
    expect(res.status).toBe(503)
  })
})

// --- PATCH email -----------------------------------------------------------

describe('PATCH /api/admin/users/:id — edit email', () => {
  it('calls updateUserEmail, mirrors the profile email, audits user.update', async () => {
    await seedUserProfile(db, { userId: 'u-edit', email: 'before@x.io' })
    const { calls } = mockClient()
    const res = await req('/api/admin/users/u-edit', 'PATCH', { email: 'after@x.io' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as AdminUserSummary
    expect(body.email).toBe('after@x.io')
    expect(calls.updateEmail).toEqual([{ id: 'u-edit', email: 'after@x.io' }])
    const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, 'u-edit'))
    expect(profile!.email).toBe('after@x.io')
    const [audit] = await db.select().from(adminAudit).where(eq(adminAudit.targetUserId, 'u-edit'))
    expect(audit!.action).toBe('user.update')
    // No PII in the audit details — only an `emailChanged` flag.
    expect(JSON.stringify(audit!.details)).not.toContain('@')
  })

  it('a missing target → 404 (before any GoTrue call)', async () => {
    const { calls } = mockClient()
    const res = await req('/api/admin/users/ghost', 'PATCH', { email: 'x@x.io' })
    expect(res.status).toBe(404)
    expect(calls.updateEmail).toHaveLength(0)
  })

  it('email taken on another account → 409', async () => {
    await seedUserProfile(db, { userId: 'u-edit', email: 'before@x.io' })
    mockClient({
      async updateUserEmail() {
        throw new AdminAuthError('email_taken', 422, 'taken')
      },
    })
    const res = await req('/api/admin/users/u-edit', 'PATCH', { email: 'dupe@x.io' })
    expect(res.status).toBe(409)
  })
})

// --- No secret ever surfaces in identity/health ----------------------------

describe('service_role never surfaces', () => {
  it('/api/health and /api/me expose no service_role / supabase key', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-role-key-DO-NOT-LEAK'
    const health = await (await req('/api/health')).text()
    expect(health).not.toContain('super-secret-role-key-DO-NOT-LEAK')
    expect(health.toLowerCase()).not.toContain('service_role')
    const me = await (await req('/api/me')).text()
    expect(me).not.toContain('super-secret-role-key-DO-NOT-LEAK')
    expect(me.toLowerCase()).not.toContain('service_role')
  })
})
