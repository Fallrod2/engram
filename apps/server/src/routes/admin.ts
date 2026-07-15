import { Hono } from 'hono'
import {
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminCreateUserSchema,
  adminDeleteUserResponseSchema,
  adminSetDemoSchema,
  adminSetRoleSchema,
  adminSetStatusSchema,
  adminStatsResponseSchema,
  adminUpdateUserSchema,
  adminUserDetailSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  adminUserSummarySchema,
  idParamSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireAdmin, requirePermission } from '../http/identity'
import { isAdminProfile } from '../services/profile.service'
import { resolveAuthConfig } from '../auth/config'
import { resolveAdminAuthClient, resolveInviteRedirect } from '../auth/admin-client'
import { AccountMgmtUnavailableError } from '../http/errors'
import {
  createUserAccount,
  deleteUser,
  listAudit,
  listUsers,
  setDemo,
  setRole,
  setStatus,
  stats,
  updateUserEmailAccount,
  userDetail,
} from '../services/admin.service'

/**
 * IAM admin API (spec §3 + rbac-groups §3/§4). The server is the SOLE authority
 * (the web guard is only a convenience). Route → guard mapping (amendment A5) —
 * some routes are delegable via a group permission, the escalation-bearing ones
 * stay `requireAdmin`:
 *
 *   GET  /users, GET /users/:id      → requirePermission('users.view')
 *   PATCH /users/:id/status          → requirePermission('users.manage')
 *   PATCH /users/:id/role            → requireAdmin   (creates/destroys an admin, A1)
 *   PATCH /users/:id/demo            → requireAdmin   (§3)
 *   DELETE /users/:id                → requireAdmin   (irreversible GDPR delete, A4)
 *   GET  /stats                      → requirePermission('stats.view')
 *   GET  /audit                      → requirePermission('audit.view')
 *
 * Every write is guarded and audited inside the service transaction; guard
 * violations surface as 403 `forbidden` with a message the web maps to a toast.
 */
export const adminRouter = new Hono()

adminRouter.get('/users', zValidator('query', adminUsersQuerySchema), async (c) => {
  requirePermission(c, 'users.view')
  return ok(c, adminUsersResponseSchema, await listUsers(db, c.req.valid('query')))
})

adminRouter.get('/users/:id', zValidator('param', idParamSchema), async (c) => {
  requirePermission(c, 'users.view')
  return ok(c, adminUserDetailSchema, await userDetail(db, c.req.valid('param').id))
})

/**
 * Create an account (spec §2, amendments A1/A2/A6). The gate is decided AFTER the
 * body is validated (the body chooses the gate — the escalation trap of A2):
 *  - `role==='admin'` → `requireAdmin` (creating an admin = super-power, parity
 *    with promote-to-admin). A `users.manage`-only delegate with `role='admin'`
 *    gets 403, BEFORE any GoTrue call or write.
 *  - else → `requirePermission('users.manage')`; AND if `groupIds` is non-empty,
 *    ALSO `requirePermission('groups.manage')` (A1 — otherwise a `users.manage`
 *    delegate could drop the new account into a powerful group, bypassing the
 *    `groups.manage` gate that guards `POST /groups/:id/members`).
 * Account management unavailable (no service_role) → clean 503 (A6), never a crash.
 */
adminRouter.post('/users', zValidator('json', adminCreateUserSchema), async (c) => {
  const body = c.req.valid('json')
  const actor = body.role === 'admin' ? requireAdmin(c) : requirePermission(c, 'users.manage')
  if (body.role !== 'admin' && body.groupIds && body.groupIds.length > 0) {
    requirePermission(c, 'groups.manage')
  }
  const cfg = resolveAuthConfig(process.env)
  const client = resolveAdminAuthClient(cfg)
  if (!client) throw new AccountMgmtUnavailableError()
  const summary = await createUserAccount(db, actor, client, body, resolveInviteRedirect(cfg))
  return ok(c, adminUserSummarySchema, summary, 201)
})

/**
 * Edit an account's email (spec §2, amendment A11) — `requirePermission('users.manage')`
 * for a plain user (not an escalation). But editing an ADMIN target's email IS an
 * admin-target action (wave-1b review): a `users.manage`-only delegate must not be
 * able to repoint an admin's login email and seize the account via forgot-password,
 * so the service demands the actor be an admin when the target is one. We resolve
 * the actor's admin status here (same predicate as `requireAdmin`) and pass it in;
 * the target's admin status is checked inside the service, before any GoTrue write.
 * GoTrue is the unicity authority (a clash → 409 `email_taken`). No config → 503.
 */
adminRouter.patch(
  '/users/:id',
  zValidator('param', idParamSchema),
  zValidator('json', adminUpdateUserSchema),
  async (c) => {
    const actor = requirePermission(c, 'users.manage')
    const cfg = resolveAuthConfig(process.env)
    const actorIsAdmin = isAdminProfile(c.get('userProfile'), actor, cfg)
    const client = resolveAdminAuthClient(cfg)
    if (!client) throw new AccountMgmtUnavailableError()
    const { id } = c.req.valid('param')
    const { email } = c.req.valid('json')
    return ok(
      c,
      adminUserSummarySchema,
      await updateUserEmailAccount(db, actor, actorIsAdmin, client, id, email),
    )
  },
)

adminRouter.patch(
  '/users/:id/role',
  zValidator('param', idParamSchema),
  zValidator('json', adminSetRoleSchema),
  async (c) => {
    const actor = requireAdmin(c)
    const { id } = c.req.valid('param')
    const { role } = c.req.valid('json')
    return ok(c, adminUserSummarySchema, await setRole(db, actor, id, role))
  },
)

adminRouter.patch(
  '/users/:id/status',
  zValidator('param', idParamSchema),
  zValidator('json', adminSetStatusSchema),
  async (c) => {
    const actor = requirePermission(c, 'users.manage')
    const { id } = c.req.valid('param')
    const { status } = c.req.valid('json')
    return ok(c, adminUserSummarySchema, await setStatus(db, actor, id, status))
  },
)

adminRouter.patch(
  '/users/:id/demo',
  zValidator('param', idParamSchema),
  zValidator('json', adminSetDemoSchema),
  async (c) => {
    const actor = requireAdmin(c)
    const { id } = c.req.valid('param')
    const { isDemo } = c.req.valid('json')
    return ok(c, adminUserSummarySchema, await setDemo(db, actor, id, isDemo))
  },
)

adminRouter.delete('/users/:id', zValidator('param', idParamSchema), async (c) => {
  const actor = requireAdmin(c)
  return ok(c, adminDeleteUserResponseSchema, await deleteUser(db, actor, c.req.valid('param').id))
})

adminRouter.get('/stats', async (c) => {
  requirePermission(c, 'stats.view')
  return ok(c, adminStatsResponseSchema, await stats(db))
})

adminRouter.get('/audit', zValidator('query', adminAuditQuerySchema), async (c) => {
  requirePermission(c, 'audit.view')
  return ok(c, adminAuditResponseSchema, await listAudit(db, c.req.valid('query').page))
})
