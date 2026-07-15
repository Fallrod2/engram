import { Hono } from 'hono'
import {
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminDeleteUserResponseSchema,
  adminSetDemoSchema,
  adminSetRoleSchema,
  adminSetStatusSchema,
  adminStatsResponseSchema,
  adminUserDetailSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  adminUserSummarySchema,
  idParamSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireAdmin } from '../http/identity'
import {
  deleteUser,
  listAudit,
  listUsers,
  setDemo,
  setRole,
  setStatus,
  stats,
  userDetail,
} from '../services/admin.service'

/**
 * IAM admin API (spec §3). `requireAdmin` on EVERY route — the server is the sole
 * authority (the web guard is only a convenience). Each write is guarded and
 * audited inside the service transaction; guard violations surface as 403
 * `forbidden` with a specific message the web maps to a toast.
 */
export const adminRouter = new Hono()

adminRouter.get('/users', zValidator('query', adminUsersQuerySchema), async (c) => {
  requireAdmin(c)
  return ok(c, adminUsersResponseSchema, await listUsers(db, c.req.valid('query')))
})

adminRouter.get('/users/:id', zValidator('param', idParamSchema), async (c) => {
  requireAdmin(c)
  return ok(c, adminUserDetailSchema, await userDetail(db, c.req.valid('param').id))
})

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
    const actor = requireAdmin(c)
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
  requireAdmin(c)
  return ok(c, adminStatsResponseSchema, await stats(db))
})

adminRouter.get('/audit', zValidator('query', adminAuditQuerySchema), async (c) => {
  requireAdmin(c)
  return ok(c, adminAuditResponseSchema, await listAudit(db, c.req.valid('query').page))
})
