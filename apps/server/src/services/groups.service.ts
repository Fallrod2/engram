import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import type {
  AdminGroup,
  AdminGroupMembersResponse,
  AdminGroupsResponse,
  AdminPermission,
} from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { adminAudit, groupMember, groupPermission, userGroup, userProfile } from '../db/schema'
import { ConflictError, NotFoundError } from '../http/errors'

/**
 * The groups service (rbac-groups §4). Delegated administration: a group grants a
 * TARGETED subset of `ADMIN_PERMISSIONS` to its non-admin members. Every WRITE is
 * audited in the SAME transaction as its effect (parity with admin.service).
 *
 * SECURITY invariants:
 *  - a group can only ever hold permissions ⊂ ADMIN_PERMISSIONS (Zod at the edge +
 *    DB CHECK backstop) — it can NEVER grant `role='admin'`, so the last-admin
 *    guard is protected INDEPENDENTLY of any group;
 *  - deciding WHAT a group grants (`setGroupPermissions`) is `requireAdmin` at the
 *    route (amendment A2) — a `groups.manage` delegate can populate/rename groups
 *    but never redefine the permissions they confer (no self-escalation).
 * Audit `details` carry ids + names only (a group name is a label, not PII).
 */

/** Assemble one group DTO (identity + member count + sorted permissions). */
async function echoGroup(db: DB | Tx, id: string): Promise<AdminGroup> {
  const [g] = await db.select().from(userGroup).where(eq(userGroup.id, id))
  if (!g) throw new NotFoundError('group not found')
  const [countRow] = await db
    .select({ n: count() })
    .from(groupMember)
    .where(eq(groupMember.groupId, id))
  const perms = await db
    .select({ permission: groupPermission.permission })
    .from(groupPermission)
    .where(eq(groupPermission.groupId, id))
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: Number(countRow?.n ?? 0),
    permissions: perms.map((p) => p.permission as AdminPermission).sort(),
    createdAt: g.createdAt.toISOString(),
  }
}

async function writeGroupAudit(
  tx: Tx,
  actorUserId: string,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(adminAudit).values({ actorUserId, action, targetUserId, details })
}

/** Reject a name that already exists case-insensitively (excluding `exceptId`). */
async function assertNameFree(db: DB | Tx, name: string, exceptId?: string): Promise<void> {
  const clash = await db
    .select({ id: userGroup.id })
    .from(userGroup)
    .where(sql`lower(${userGroup.name}) = lower(${name})`)
  if (clash.some((r) => r.id !== exceptId)) {
    throw new ConflictError('a group with this name already exists')
  }
}

export async function listGroups(db: DB): Promise<AdminGroupsResponse> {
  const groups = await db.select().from(userGroup).orderBy(asc(userGroup.name))
  if (groups.length === 0) return { groups: [] }
  const ids = groups.map((g) => g.id)
  const [counts, perms] = await Promise.all([
    db
      .select({ groupId: groupMember.groupId, n: count() })
      .from(groupMember)
      .where(inArray(groupMember.groupId, ids))
      .groupBy(groupMember.groupId),
    db
      .select({ groupId: groupPermission.groupId, permission: groupPermission.permission })
      .from(groupPermission)
      .where(inArray(groupPermission.groupId, ids)),
  ])
  const countMap = new Map(counts.map((c) => [c.groupId, Number(c.n)]))
  const permMap = new Map<string, AdminPermission[]>()
  for (const p of perms) {
    const list = permMap.get(p.groupId) ?? []
    list.push(p.permission as AdminPermission)
    permMap.set(p.groupId, list)
  }
  return {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: countMap.get(g.id) ?? 0,
      permissions: (permMap.get(g.id) ?? []).sort(),
      createdAt: g.createdAt.toISOString(),
    })),
  }
}

export async function createGroup(
  db: DB,
  actorUserId: string,
  input: { name: string; description?: string | undefined },
): Promise<AdminGroup> {
  let groupId!: string
  await db.transaction(async (tx) => {
    await assertNameFree(tx, input.name)
    const [row] = await tx
      .insert(userGroup)
      .values({ name: input.name, description: input.description ?? null })
      .returning({ id: userGroup.id })
    groupId = row!.id
    await writeGroupAudit(tx, actorUserId, 'group.create', null, {
      groupId,
      name: input.name,
    })
  })
  return echoGroup(db, groupId)
}

export async function updateGroup(
  db: DB,
  actorUserId: string,
  groupId: string,
  input: { name?: string | undefined; description?: string | null | undefined },
): Promise<AdminGroup> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userGroup).where(eq(userGroup.id, groupId))
    if (!existing) throw new NotFoundError('group not found')
    if (input.name !== undefined) await assertNameFree(tx, input.name, groupId)
    const patch: { name?: string; description?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    }
    if (input.name !== undefined) patch.name = input.name
    if (input.description !== undefined) patch.description = input.description
    await tx.update(userGroup).set(patch).where(eq(userGroup.id, groupId))
    await writeGroupAudit(tx, actorUserId, 'group.update', null, {
      groupId,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { descriptionChanged: true } : {}),
    })
  })
  return echoGroup(db, groupId)
}

export async function deleteGroup(
  db: DB,
  actorUserId: string,
  groupId: string,
): Promise<{ deleted: true }> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userGroup).where(eq(userGroup.id, groupId))
    if (!existing) throw new NotFoundError('group not found')
    // FK ON DELETE CASCADE removes memberships + permissions with the parent row.
    await tx.delete(userGroup).where(eq(userGroup.id, groupId))
    await writeGroupAudit(tx, actorUserId, 'group.delete', null, {
      groupId,
      name: existing.name,
    })
  })
  return { deleted: true }
}

/**
 * Replace a group's permission set (route guard: `requireAdmin`, amendment A2).
 * `permissions` is already validated ⊂ ADMIN_PERMISSIONS + deduped at the edge;
 * dedup again defensively. Full replace inside one transaction.
 */
export async function setGroupPermissions(
  db: DB,
  actorUserId: string,
  groupId: string,
  permissions: AdminPermission[],
): Promise<AdminGroup> {
  const unique = [...new Set(permissions)]
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userGroup).where(eq(userGroup.id, groupId))
    if (!existing) throw new NotFoundError('group not found')
    await tx.delete(groupPermission).where(eq(groupPermission.groupId, groupId))
    if (unique.length > 0) {
      await tx.insert(groupPermission).values(unique.map((permission) => ({ groupId, permission })))
    }
    await writeGroupAudit(tx, actorUserId, 'group.permissions', null, {
      groupId,
      permissions: unique.sort(),
    })
  })
  return echoGroup(db, groupId)
}

export async function listMembers(db: DB, groupId: string): Promise<AdminGroupMembersResponse> {
  const [existing] = await db.select().from(userGroup).where(eq(userGroup.id, groupId))
  if (!existing) throw new NotFoundError('group not found')
  const rows = await db
    .select({ userId: groupMember.userId, email: userProfile.email })
    .from(groupMember)
    .leftJoin(userProfile, eq(userProfile.userId, groupMember.userId))
    .where(eq(groupMember.groupId, groupId))
    .orderBy(asc(groupMember.userId))
  return { members: rows.map((r) => ({ userId: r.userId, email: r.email ?? null })) }
}

export async function addMember(
  db: DB,
  actorUserId: string,
  groupId: string,
  memberUserId: string,
): Promise<AdminGroupMembersResponse> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userGroup).where(eq(userGroup.id, groupId))
    if (!existing) throw new NotFoundError('group not found')
    // Idempotent: adding an existing member is a no-op (no duplicate audit noise).
    const inserted = await tx
      .insert(groupMember)
      .values({ groupId, userId: memberUserId })
      .onConflictDoNothing()
      .returning({ userId: groupMember.userId })
    if (inserted.length > 0) {
      await writeGroupAudit(tx, actorUserId, 'group.member.add', memberUserId, { groupId })
    }
  })
  return listMembers(db, groupId)
}

export async function removeMember(
  db: DB,
  actorUserId: string,
  groupId: string,
  memberUserId: string,
): Promise<AdminGroupMembersResponse> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(userGroup).where(eq(userGroup.id, groupId))
    if (!existing) throw new NotFoundError('group not found')
    const removed = await tx
      .delete(groupMember)
      .where(sql`${groupMember.groupId} = ${groupId} and ${groupMember.userId} = ${memberUserId}`)
      .returning({ userId: groupMember.userId })
    if (removed.length > 0) {
      await writeGroupAudit(tx, actorUserId, 'group.member.remove', memberUserId, { groupId })
    }
  })
  return listMembers(db, groupId)
}
