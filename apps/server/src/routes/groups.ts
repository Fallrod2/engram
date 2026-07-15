import { Hono } from 'hono'
import {
  adminAddMemberSchema,
  adminCreateGroupSchema,
  adminGroupSchema,
  adminGroupDeleteResponseSchema,
  adminGroupMemberParamSchema,
  adminGroupMembersResponseSchema,
  adminGroupsResponseSchema,
  adminSetGroupPermissionsSchema,
  adminUpdateGroupSchema,
  idParamSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireAdmin, requirePermission } from '../http/identity'
import {
  addMember,
  createGroup,
  deleteGroup,
  listGroups,
  listMembers,
  removeMember,
  setGroupPermissions,
  updateGroup,
} from '../services/groups.service'

/**
 * Groups / delegated-administration API (rbac-groups §4). Route → guard mapping
 * (amendment A2/A3/A5) — the SERVER is the sole authority:
 *
 *   GET/POST/PATCH/DELETE /groups*, members, GET /:id/members
 *                                    → requirePermission('groups.manage')
 *   PUT /groups/:id/permissions      → requireAdmin  (defines what a group grants;
 *                                       amendment A2 — the escalation frontier, so
 *                                       a `groups.manage` delegate can NEVER
 *                                       self-grant a permission)
 *
 * A3 (accepted trade-off, documented): `groups.manage` is a quasi-admin capability
 * — a delegate can populate any group's membership. That is safe ONLY because A2
 * keeps "what a group grants" admin-decided, so every delegated permission still
 * traces to an admin decision. Every write is audited in its service transaction.
 */
export const groupsRouter = new Hono()

groupsRouter.get('/', async (c) => {
  requirePermission(c, 'groups.manage')
  return ok(c, adminGroupsResponseSchema, await listGroups(db))
})

groupsRouter.post('/', zValidator('json', adminCreateGroupSchema), async (c) => {
  const actor = requirePermission(c, 'groups.manage')
  return ok(c, adminGroupSchema, await createGroup(db, actor, c.req.valid('json')), 201)
})

groupsRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', adminUpdateGroupSchema),
  async (c) => {
    const actor = requirePermission(c, 'groups.manage')
    return ok(
      c,
      adminGroupSchema,
      await updateGroup(db, actor, c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

groupsRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const actor = requirePermission(c, 'groups.manage')
  return ok(
    c,
    adminGroupDeleteResponseSchema,
    await deleteGroup(db, actor, c.req.valid('param').id),
  )
})

// The escalation frontier: only an admin defines WHAT a group grants (amendment A2).
groupsRouter.put(
  '/:id/permissions',
  zValidator('param', idParamSchema),
  zValidator('json', adminSetGroupPermissionsSchema),
  async (c) => {
    const actor = requireAdmin(c)
    return ok(
      c,
      adminGroupSchema,
      await setGroupPermissions(
        db,
        actor,
        c.req.valid('param').id,
        c.req.valid('json').permissions,
      ),
    )
  },
)

groupsRouter.get('/:id/members', zValidator('param', idParamSchema), async (c) => {
  requirePermission(c, 'groups.manage')
  return ok(c, adminGroupMembersResponseSchema, await listMembers(db, c.req.valid('param').id))
})

groupsRouter.post(
  '/:id/members',
  zValidator('param', idParamSchema),
  zValidator('json', adminAddMemberSchema),
  async (c) => {
    const actor = requirePermission(c, 'groups.manage')
    return ok(
      c,
      adminGroupMembersResponseSchema,
      await addMember(db, actor, c.req.valid('param').id, c.req.valid('json').userId),
    )
  },
)

groupsRouter.delete(
  '/:id/members/:userId',
  zValidator('param', adminGroupMemberParamSchema),
  async (c) => {
    const actor = requirePermission(c, 'groups.manage')
    const { id, userId } = c.req.valid('param')
    return ok(c, adminGroupMembersResponseSchema, await removeMember(db, actor, id, userId))
  },
)
