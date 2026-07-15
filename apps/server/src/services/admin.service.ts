import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import type {
  AdminAuditResponse,
  AdminCreateUser,
  AdminDeleteCounts,
  AdminDeleteUserResponse,
  AdminStatsResponse,
  AdminUserDetail,
  AdminUserGroupRef,
  AdminUserSummary,
  AdminUsersQuery,
  AdminUsersResponse,
  UserRole,
  UserStatus,
} from '@engram/shared'
import { ADMIN_AUDIT_PAGE_SIZE, ADMIN_USERS_PAGE_SIZE, adminKnownProviders } from '@engram/shared'
import type { DB, Tx } from '../db/client'
import {
  adminAudit,
  aiCredential,
  appSettings,
  card,
  deck,
  exam,
  generation,
  groupMember,
  note,
  reviewLog,
  subject,
  userGroup,
  userProfile,
} from '../db/schema'
import { localDayKey, localMidnight } from '../lib/day'
import { resolveAuthConfig } from '../auth/config'
import { AdminAuthError, type AdminAuthClient } from '../auth/admin-client'
import {
  EmailTakenError,
  ForbiddenError,
  InvalidEmailError,
  NotFoundError,
  UpstreamError,
} from '../http/errors'
import { wipeUserData } from './demo.service'
import {
  effectiveActiveAdminIds,
  getEmailsByIds,
  getProfile,
  lockAdminGuard,
  wouldBeLastActiveAdmin,
} from './profile.service'

/**
 * The admin/IAM service (spec §3). Every WRITE is guarded (no self-demote/suspend/
 * delete, never the last effective active admin, demo never promoted, admin never
 * demo) AND audited in the SAME transaction as its effect — so the journal can
 * never disagree with reality. No response ever carries a secret or (in stored
 * audit rows) any PII (amendment A13): emails are joined only at read time.
 */

// --- Per-user usage aggregates (secret-free) -------------------------------
// Grouped subqueries LEFT-JOINed onto `user_profile`. NOT correlated scalar
// subqueries: drizzle does not qualify a bare `${table.column}` inside a `sql`
// fragment, so `where ${card.userId} = ${userProfile.userId}` would collapse to
// `where user_id = user_id` (always true → counts EVERY row). The grouped-join
// form scopes correctly and each aggregate is 1:1 with the profile on user_id
// (no row multiplication).

function usageAggregates(db: DB) {
  // Each count/sum gets a UNIQUE alias: drizzle renders a subquery field as its
  // bare `.as()` name inside a `sql` fragment (no table qualification), so reusing
  // `n` across joins would make `coalesce("n", 0)` ambiguous.
  const subjects = db
    .select({ uid: subject.userId, n: count().as('subjects_n') })
    .from(subject)
    .groupBy(subject.userId)
    .as('subjects_agg')
  const decks = db
    .select({ uid: deck.userId, n: count().as('decks_n') })
    .from(deck)
    .groupBy(deck.userId)
    .as('decks_agg')
  const cards = db
    .select({ uid: card.userId, n: count().as('cards_n') })
    .from(card)
    .groupBy(card.userId)
    .as('cards_agg')
  const notes = db
    .select({ uid: note.userId, n: count().as('notes_n') })
    .from(note)
    .groupBy(note.userId)
    .as('notes_agg')
  const reviews = db
    .select({ uid: reviewLog.userId, n: count().as('reviews_n') })
    .from(reviewLog)
    .groupBy(reviewLog.userId)
    .as('reviews_agg')
  const gens = db
    .select({
      uid: generation.userId,
      n: count().as('gens_n'),
      // Columns here live in the `generation` FROM, so bare names are unambiguous.
      tokens:
        sql<number>`coalesce(sum(coalesce(${generation.promptTokens}, 0) + coalesce(${generation.completionTokens}, 0)), 0)`.as(
          'gens_tokens',
        ),
    })
    .from(generation)
    .groupBy(generation.userId)
    .as('gens_agg')
  return { subjects, decks, cards, notes, reviews, gens }
}

/** `coalesce(agg.col, 0)` → a Number-mapped expression (each alias is unique). */
const num = (col: unknown) => sql<number>`coalesce(${col}, 0)`.mapWith(Number)

function toSummary(
  row: {
    userId: string
    email: string | null
    role: string
    status: string
    isDemo: boolean
    createdAt: Date
    lastSeenAt: Date
    subjects: number
    cards: number
    notes: number
    generations: number
    tokens: number
  },
  groups: AdminUserGroupRef[] = [],
): AdminUserSummary {
  return {
    userId: row.userId,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'suspended' ? 'suspended' : 'active',
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    subjects: row.subjects,
    cards: row.cards,
    notes: row.notes,
    generations: row.generations,
    tokens: row.tokens,
    groups,
  }
}

/**
 * Resolve the group memberships of a set of users in ONE query (id + name), keyed
 * by user id. Empty ids → empty map (no query). Used to decorate the user list /
 * detail / write echoes with `groups` chips (rbac-groups §4).
 */
async function groupsByUserIds(
  db: DB,
  userIds: string[],
): Promise<Map<string, AdminUserGroupRef[]>> {
  const ids = [...new Set(userIds)].filter((id) => id.length > 0)
  const map = new Map<string, AdminUserGroupRef[]>()
  if (ids.length === 0) return map
  const rows = await db
    .select({ userId: groupMember.userId, id: userGroup.id, name: userGroup.name })
    .from(groupMember)
    .innerJoin(userGroup, eq(userGroup.id, groupMember.groupId))
    .where(inArray(groupMember.userId, ids))
    .orderBy(asc(userGroup.name))
  for (const r of rows) {
    const list = map.get(r.userId) ?? []
    list.push({ id: r.id, name: r.name })
    map.set(r.userId, list)
  }
  return map
}

/** Escape LIKE metacharacters so a literal `%`/`_` never widens the filter (A11). */
function searchClause(query: string | undefined): SQL | undefined {
  if (!query) return undefined
  const escaped = query.replace(/[\\%_]/g, (m) => `\\${m}`)
  const pattern = `%${escaped}%`
  return or(ilike(userProfile.email, pattern), ilike(userProfile.userId, pattern))
}

export async function listUsers(db: DB, params: AdminUsersQuery): Promise<AdminUsersResponse> {
  const where = searchClause(params.query)
  const [{ total }] = (await db.select({ total: count() }).from(userProfile).where(where)) as [
    { total: number },
  ]

  const pageSize = ADMIN_USERS_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(params.page, totalPages)

  const agg = usageAggregates(db)
  const cardsCol = num(agg.cards.n)
  const tokensCol = num(agg.gens.tokens)
  // Map the closed sort enum to a concrete ORDER BY expression (never raw, A11).
  const wrap = params.dir === 'asc' ? asc : desc
  const orderExpr =
    params.sort === 'createdAt'
      ? wrap(userProfile.createdAt)
      : params.sort === 'email'
        ? wrap(userProfile.email)
        : params.sort === 'cards'
          ? wrap(cardsCol)
          : params.sort === 'tokens'
            ? wrap(tokensCol)
            : wrap(userProfile.lastSeenAt)

  const rows = await db
    .select({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
      createdAt: userProfile.createdAt,
      lastSeenAt: userProfile.lastSeenAt,
      subjects: num(agg.subjects.n),
      cards: cardsCol,
      notes: num(agg.notes.n),
      generations: num(agg.gens.n),
      tokens: tokensCol,
    })
    .from(userProfile)
    .leftJoin(agg.subjects, eq(agg.subjects.uid, userProfile.userId))
    .leftJoin(agg.cards, eq(agg.cards.uid, userProfile.userId))
    .leftJoin(agg.notes, eq(agg.notes.uid, userProfile.userId))
    .leftJoin(agg.gens, eq(agg.gens.uid, userProfile.userId))
    .where(where)
    // Secondary key keeps pagination deterministic when the primary ties.
    .orderBy(orderExpr, asc(userProfile.userId))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const groups = await groupsByUserIds(
    db,
    rows.map((r) => r.userId),
  )
  return {
    users: rows.map((r) => toSummary(r, groups.get(r.userId) ?? [])),
    page,
    pageSize,
    total,
    totalPages,
  }
}

export async function userDetail(db: DB, userId: string): Promise<AdminUserDetail> {
  const agg = usageAggregates(db)
  const [row] = await db
    .select({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
      createdAt: userProfile.createdAt,
      lastSeenAt: userProfile.lastSeenAt,
      subjects: num(agg.subjects.n),
      cards: num(agg.cards.n),
      notes: num(agg.notes.n),
      generations: num(agg.gens.n),
      tokens: num(agg.gens.tokens),
      decks: num(agg.decks.n),
      reviews: num(agg.reviews.n),
    })
    .from(userProfile)
    .leftJoin(agg.subjects, eq(agg.subjects.uid, userProfile.userId))
    .leftJoin(agg.decks, eq(agg.decks.uid, userProfile.userId))
    .leftJoin(agg.cards, eq(agg.cards.uid, userProfile.userId))
    .leftJoin(agg.notes, eq(agg.notes.uid, userProfile.userId))
    .leftJoin(agg.reviews, eq(agg.reviews.uid, userProfile.userId))
    .leftJoin(agg.gens, eq(agg.gens.uid, userProfile.userId))
    .where(eq(userProfile.userId, userId))
  if (!row) throw new NotFoundError('user not found')

  const providerRows = await db
    .select({
      provider: generation.provider,
      generations: count(),
      tokens:
        sql<number>`coalesce(sum(coalesce(${generation.promptTokens}, 0) + coalesce(${generation.completionTokens}, 0)), 0)`.mapWith(
          Number,
        ),
    })
    .from(generation)
    .where(eq(generation.userId, userId))
    .groupBy(generation.provider)

  const byProvider = providerRows.map((p) => ({
    provider: p.provider ?? 'unknown',
    generations: p.generations,
    tokens: p.tokens,
  }))

  // 30-day activity, bucketed by LOCAL day in JS (same approach as analytics).
  const now = new Date()
  const from = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const [gens, revs] = await Promise.all([
    db
      .select({ createdAt: generation.createdAt })
      .from(generation)
      .where(and(eq(generation.userId, userId), gte(generation.createdAt, from))),
    db
      .select({ review: reviewLog.review })
      .from(reviewLog)
      .where(and(eq(reviewLog.userId, userId), gte(reviewLog.review, from))),
  ])
  const activity30d = build30dActivity(now, gens, revs)

  const groups = (await groupsByUserIds(db, [userId])).get(userId) ?? []
  return {
    ...toSummary(row, groups),
    decks: row.decks,
    reviews: row.reviews,
    byProvider,
    activity30d,
  }
}

function build30dActivity(
  now: Date,
  gens: { createdAt: Date }[],
  revs: { review: Date }[],
): AdminUserDetail['activity30d'] {
  const genByDay = new Map<string, number>()
  for (const g of gens)
    genByDay.set(localDayKey(g.createdAt), (genByDay.get(localDayKey(g.createdAt)) ?? 0) + 1)
  const revByDay = new Map<string, number>()
  for (const r of revs)
    revByDay.set(localDayKey(r.review), (revByDay.get(localDayKey(r.review)) ?? 0) + 1)
  const out: AdminUserDetail['activity30d'] = []
  for (let i = 29; i >= 0; i--) {
    const day = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = localDayKey(day)
    out.push({ date: key, generations: genByDay.get(key) ?? 0, reviews: revByDay.get(key) ?? 0 })
  }
  return out
}

// --- Audit -----------------------------------------------------------------

async function writeAudit(
  tx: Tx,
  actorUserId: string,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(adminAudit).values({ actorUserId, action, targetUserId, details })
}

export async function listAudit(db: DB, page: number): Promise<AdminAuditResponse> {
  const [{ total }] = (await db.select({ total: count() }).from(adminAudit)) as [{ total: number }]
  const pageSize = ADMIN_AUDIT_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const p = Math.min(page, totalPages)
  const rows = await db
    .select({
      id: adminAudit.id,
      actorUserId: adminAudit.actorUserId,
      action: adminAudit.action,
      targetUserId: adminAudit.targetUserId,
      details: adminAudit.details,
      createdAt: adminAudit.createdAt,
    })
    .from(adminAudit)
    .orderBy(desc(adminAudit.createdAt))
    .limit(pageSize)
    .offset((p - 1) * pageSize)

  const emails = await getEmailsByIds(
    db,
    rows.flatMap((r) => [r.actorUserId, r.targetUserId ?? '']),
  )
  const entries = rows.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    actorEmail: emails.get(r.actorUserId) ?? null,
    action: r.action as AdminAuditResponse['entries'][number]['action'],
    targetUserId: r.targetUserId,
    targetEmail: r.targetUserId ? (emails.get(r.targetUserId) ?? null) : null,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }))
  return { entries, page: p, pageSize, total, totalPages }
}

// --- Writes (guarded + audited) --------------------------------------------

/** Fetch the target profile or 404 — shared by every write. */
async function requireTarget(tx: Tx, userId: string) {
  const profile = await getProfile(tx, userId)
  if (!profile) throw new NotFoundError('user not found')
  return profile
}

export async function setRole(
  db: DB,
  actorUserId: string,
  targetUserId: string,
  role: UserRole,
): Promise<AdminUserSummary> {
  const cfg = resolveAuthConfig(process.env)
  await db.transaction(async (tx) => {
    // Serialize with the other admin-invariant writes so the last-admin recount
    // below sees committed state, not a stale snapshot (concurrent demote race).
    await lockAdminGuard(tx)
    const target = await requireTarget(tx, targetUserId)
    if (role === 'user') {
      if (targetUserId === actorUserId) throw new ForbiddenError('cannot demote yourself')
      if (await wouldBeLastActiveAdmin(tx, cfg, targetUserId)) {
        throw new ForbiddenError('cannot demote the last active admin')
      }
    } else if (target.isDemo) {
      // The demo account can never be promoted (also enforced by a DB CHECK).
      throw new ForbiddenError('the demo account cannot be promoted')
    }
    if (target.role === role) return // idempotent no-op, no audit noise
    await tx
      .update(userProfile)
      .set({ role, updatedAt: new Date() })
      .where(eq(userProfile.userId, targetUserId))
    await writeAudit(
      tx,
      actorUserId,
      role === 'admin' ? 'role.promote' : 'role.demote',
      targetUserId,
      {
        from: target.role,
        to: role,
      },
    )
  })
  return echoSummary(db, targetUserId)
}

export async function setStatus(
  db: DB,
  actorUserId: string,
  targetUserId: string,
  status: UserStatus,
): Promise<AdminUserSummary> {
  const cfg = resolveAuthConfig(process.env)
  await db.transaction(async (tx) => {
    // Serialize with the other admin-invariant writes so the last-admin recount
    // below sees committed state, not a stale snapshot (concurrent suspend race).
    await lockAdminGuard(tx)
    const target = await requireTarget(tx, targetUserId)
    if (status === 'suspended') {
      if (targetUserId === actorUserId) throw new ForbiddenError('cannot suspend yourself')
      if (await wouldBeLastActiveAdmin(tx, cfg, targetUserId)) {
        throw new ForbiddenError('cannot suspend the last active admin')
      }
    }
    if (target.status === status) return
    await tx
      .update(userProfile)
      .set({ status, updatedAt: new Date() })
      .where(eq(userProfile.userId, targetUserId))
    await writeAudit(
      tx,
      actorUserId,
      status === 'suspended' ? 'status.suspend' : 'status.reactivate',
      targetUserId,
      { from: target.status, to: status },
    )
  })
  return echoSummary(db, targetUserId)
}

export async function setDemo(
  db: DB,
  actorUserId: string,
  targetUserId: string,
  isDemo: boolean,
): Promise<AdminUserSummary> {
  await db.transaction(async (tx) => {
    const target = await requireTarget(tx, targetUserId)
    if (isDemo && target.role === 'admin') {
      throw new ForbiddenError('an admin cannot be the demo account')
    }
    if (target.isDemo === isDemo) return
    if (isDemo) {
      // Enforce single-demo: clear any previous flag first (the DB partial-unique
      // index is the concurrency backstop; this keeps the common path clean + one
      // audit trail). Record which user lost the flag in the details.
      const previous = await tx
        .update(userProfile)
        .set({ isDemo: false, updatedAt: new Date() })
        .where(and(eq(userProfile.isDemo, true), sql`${userProfile.userId} <> ${targetUserId}`))
        .returning({ userId: userProfile.userId })
      await tx
        .update(userProfile)
        .set({ isDemo: true, updatedAt: new Date() })
        .where(eq(userProfile.userId, targetUserId))
      await writeAudit(tx, actorUserId, 'demo.set', targetUserId, {
        cleared: previous.map((p) => p.userId),
      })
    } else {
      await tx
        .update(userProfile)
        .set({ isDemo: false, updatedAt: new Date() })
        .where(eq(userProfile.userId, targetUserId))
      await writeAudit(tx, actorUserId, 'demo.unset', targetUserId, {})
    }
  })
  return echoSummary(db, targetUserId)
}

/**
 * UUID shape guard for the best-effort `auth.users` delete (amendment A6) AND for
 * validating the `sub` GoTrue returns on create/invite before we upsert a profile
 * (amendment A7 — a non-uuid sub would make the row un-deletable later). Exported
 * as the SINGLE regex so account CRUD never re-implements a divergent one.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function deleteUser(
  db: DB,
  actorUserId: string,
  targetUserId: string,
): Promise<AdminDeleteUserResponse> {
  const cfg = resolveAuthConfig(process.env)
  if (targetUserId === actorUserId) throw new ForbiddenError('cannot delete yourself')

  let deletedCounts!: AdminDeleteCounts
  await db.transaction(async (tx) => {
    // Serialize with the other admin-invariant writes so the last-admin recount
    // below sees committed state, not a stale snapshot (concurrent delete race).
    await lockAdminGuard(tx)
    const target = await requireTarget(tx, targetUserId)
    if (target.role === 'admin') {
      // Never delete an effective active admin if it is the last one.
      const set = await effectiveActiveAdminIds(tx, cfg)
      set.delete(targetUserId)
      if (set.size === 0) throw new ForbiddenError('cannot delete the last active admin')
    }
    if (target.isDemo)
      throw new ForbiddenError('unset the demo flag before deleting the demo account')

    deletedCounts = await countUserData(tx, targetUserId)
    await wipeUserData(tx, targetUserId)
    await tx.delete(appSettings).where(eq(appSettings.userId, targetUserId))
    await tx.delete(aiCredential).where(eq(aiCredential.userId, targetUserId))
    // Purge group memberships (amendment E1): `group_member.user_id` has no FK to
    // `user_profile`, so a GDPR delete must remove them explicitly — otherwise a
    // future user reusing the same `sub` would inherit phantom groups. NOT done in
    // `wipeUserData` (that runs on every demo reset; a demo keeps its groups).
    await tx.delete(groupMember).where(eq(groupMember.userId, targetUserId))
    await tx.delete(userProfile).where(eq(userProfile.userId, targetUserId))
    await writeAudit(tx, actorUserId, 'user.delete', targetUserId, { deletedCounts })
  })

  // Best-effort GoTrue delete, OUTSIDE the committed public transaction so it can
  // never 500 after the wipe (amendment A6): probe the auth schema, require a uuid
  // sub, and swallow any error → `authDeleted:false` (login not revoked, honest).
  const authDeleted = await tryDeleteAuthUser(db, targetUserId)
  return { authDeleted, deletedCounts }
}

async function tryDeleteAuthUser(db: DB, userId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) return false
  try {
    const probe = await db.execute(sql`select to_regclass('auth.users') is not null as present`)
    // Normalize across drivers: postgres-js returns an array, PGlite `{ rows }`.
    const rows = Array.isArray(probe) ? probe : ((probe as { rows?: unknown[] }).rows ?? [])
    const present = (rows[0] as { present?: boolean } | undefined)?.present === true
    if (!present) return false
    await db.execute(sql`delete from auth.users where id = ${userId}::uuid`)
    return true
  } catch {
    return false
  }
}

// --- Account CRUD (spec §2, GoTrue Admin API) ------------------------------

/**
 * Translate a classified GoTrue failure into the public `ApiError` (secret-free —
 * amendment A5.3): `email_taken` → 409, `invalid_email` → 400, else 502. Any other
 * throwable bubbles unchanged (never swallow a bug into a 502).
 */
function mapAuthError(e: unknown): never {
  if (e instanceof AdminAuthError) {
    if (e.kind === 'email_taken') throw new EmailTakenError()
    if (e.kind === 'invalid_email') throw new InvalidEmailError()
    throw new UpstreamError('the auth provider refused the request')
  }
  throw e
}

/**
 * Create an account (spec §2, amendments A7/A8/A10). The route has ALREADY run the
 * gate (A2: role decides `requireAdmin` vs `requirePermission('users.manage')`;
 * A1: `groupIds` also requires `groups.manage`) and resolved the injected `client`
 * + trusted `redirectTo`. Ordering minimizes an orphaned `auth.users` row:
 *   1. validate every `groupId` exists (BEFORE any GoTrue call),
 *   2. GoTrue create/invite → the authoritative `sub`,
 *   3. validate the `sub` is a uuid (A7) — else 502, no profile written,
 *   4. ONE transaction: upsert profile + insert memberships + audit `user.create`.
 * The password (password mode) is passed to GoTrue over TLS and NEVER audited,
 * logged, or echoed. A residual orphan (tx fails post-GoTrue) → 500; documented.
 */
export async function createUserAccount(
  db: DB,
  actorUserId: string,
  client: AdminAuthClient,
  input: AdminCreateUser,
  redirectTo: string,
): Promise<AdminUserSummary> {
  const groupIds = input.groupIds ? [...new Set(input.groupIds)] : []
  if (groupIds.length > 0) {
    const rows = await db
      .select({ id: userGroup.id })
      .from(userGroup)
      .where(inArray(userGroup.id, groupIds))
    const found = new Set(rows.map((r) => r.id))
    if (groupIds.some((id) => !found.has(id))) throw new NotFoundError('group not found')
  }

  let sub = ''
  try {
    sub =
      input.mode === 'invite'
        ? (await client.inviteUser(input.email, redirectTo)).id
        : (
            await client.createUser({
              email: input.email,
              password: input.password,
              emailConfirm: true,
            })
          ).id
  } catch (e) {
    mapAuthError(e)
  }
  if (!UUID_RE.test(sub)) throw new UpstreamError('unexpected identity from the auth provider')
  const newSub = sub

  await db.transaction(async (tx) => {
    const now = new Date()
    await tx
      .insert(userProfile)
      .values({
        userId: newSub,
        email: input.email,
        role: input.role,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: { email: input.email, role: input.role, updatedAt: now },
      })
    if (groupIds.length > 0) {
      await tx
        .insert(groupMember)
        .values(groupIds.map((groupId) => ({ groupId, userId: newSub })))
        .onConflictDoNothing()
    }
    // Audit carries mode + role + group ids only — NEVER the password (A10).
    await writeAudit(tx, actorUserId, 'user.create', newSub, {
      mode: input.mode,
      role: input.role,
      ...(groupIds.length > 0 ? { groupIds } : {}),
    })
  })
  return echoSummary(db, newSub)
}

/**
 * Change an existing account's login email (spec §2, amendment A11). GoTrue is the
 * unicity authority (`user_profile.email` is NOT unique) — a clash on another
 * account surfaces as 409 `email_taken`. Order: verify the target profile exists
 * (404 otherwise), then GoTrue, then mirror `user_profile.email` + audit
 * `user.update` with `{ emailChanged: true }` (no PII, parity groups.service).
 */
export async function updateUserEmailAccount(
  db: DB,
  actorUserId: string,
  client: AdminAuthClient,
  targetUserId: string,
  email: string,
): Promise<AdminUserSummary> {
  const target = await getProfile(db, targetUserId)
  if (!target) throw new NotFoundError('user not found')
  try {
    await client.updateUserEmail(targetUserId, email)
  } catch (e) {
    mapAuthError(e)
  }
  await db.transaction(async (tx) => {
    await tx
      .update(userProfile)
      .set({ email, updatedAt: new Date() })
      .where(eq(userProfile.userId, targetUserId))
    await writeAudit(tx, actorUserId, 'user.update', targetUserId, { emailChanged: true })
  })
  return echoSummary(db, targetUserId)
}

async function countUserData(tx: Tx, userId: string): Promise<AdminDeleteCounts> {
  const n = async (q: Promise<{ n: number }[]>): Promise<number> => (await q)[0]?.n ?? 0
  const [subjects, decks, cards, reviewLogs, notes, generations, exams, settings, creds] =
    await Promise.all([
      n(tx.select({ n: count() }).from(subject).where(eq(subject.userId, userId))),
      n(tx.select({ n: count() }).from(deck).where(eq(deck.userId, userId))),
      n(tx.select({ n: count() }).from(card).where(eq(card.userId, userId))),
      n(tx.select({ n: count() }).from(reviewLog).where(eq(reviewLog.userId, userId))),
      n(tx.select({ n: count() }).from(note).where(eq(note.userId, userId))),
      n(tx.select({ n: count() }).from(generation).where(eq(generation.userId, userId))),
      n(tx.select({ n: count() }).from(exam).where(eq(exam.userId, userId))),
      n(tx.select({ n: count() }).from(appSettings).where(eq(appSettings.userId, userId))),
      n(tx.select({ n: count() }).from(aiCredential).where(eq(aiCredential.userId, userId))),
    ])
  return {
    subjects,
    decks,
    cards,
    reviewLogs,
    notes,
    generations,
    exams,
    appSettings: settings,
    aiCredentials: creds,
  }
}

async function echoSummary(db: DB, userId: string): Promise<AdminUserSummary> {
  const agg = usageAggregates(db)
  const [row] = await db
    .select({
      userId: userProfile.userId,
      email: userProfile.email,
      role: userProfile.role,
      status: userProfile.status,
      isDemo: userProfile.isDemo,
      createdAt: userProfile.createdAt,
      lastSeenAt: userProfile.lastSeenAt,
      subjects: num(agg.subjects.n),
      cards: num(agg.cards.n),
      notes: num(agg.notes.n),
      generations: num(agg.gens.n),
      tokens: num(agg.gens.tokens),
    })
    .from(userProfile)
    .leftJoin(agg.subjects, eq(agg.subjects.uid, userProfile.userId))
    .leftJoin(agg.cards, eq(agg.cards.uid, userProfile.userId))
    .leftJoin(agg.notes, eq(agg.notes.uid, userProfile.userId))
    .leftJoin(agg.gens, eq(agg.gens.uid, userProfile.userId))
    .where(eq(userProfile.userId, userId))
  if (!row) throw new NotFoundError('user not found')
  const groups = (await groupsByUserIds(db, [userId])).get(userId) ?? []
  return toSummary(row, groups)
}

// --- Stats -----------------------------------------------------------------

export async function stats(db: DB): Promise<AdminStatsResponse> {
  const now = new Date()
  const from30 = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

  const [totalsRow] = await db
    .select({
      users: count(),
      // Use the typed `gte` helper, not a raw `${sevenDaysAgo}` interpolation:
      // a bare Date param has no SQL type, so postgres-js (prepared statements,
      // the default on a direct connection) throws serializing it — while PGlite
      // tolerates it. `gte` binds the Date through the column's timestamp mapper
      // (same as `generation.createdAt` below), so it is safe on both drivers.
      active7d:
        sql<number>`coalesce(sum(case when ${gte(userProfile.lastSeenAt, sevenDaysAgo)} then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      suspended:
        sql<number>`coalesce(sum(case when ${userProfile.status} = 'suspended' then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
      admins:
        sql<number>`coalesce(sum(case when ${userProfile.role} = 'admin' then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
    })
    .from(userProfile)

  const [gen30] = await db
    .select({
      generations: count(),
      tokens:
        sql<number>`coalesce(sum(coalesce(${generation.promptTokens}, 0) + coalesce(${generation.completionTokens}, 0)), 0)`.mapWith(
          Number,
        ),
    })
    .from(generation)
    .where(gte(generation.createdAt, from30))

  const [ocr] = await db.select({ n: count() }).from(note).where(eq(note.sourceType, 'image'))

  const signups = await db
    .select({ createdAt: userProfile.createdAt })
    .from(userProfile)
    .where(gte(userProfile.createdAt, from30))
  const gensForSeries = await db
    .select({ createdAt: generation.createdAt, provider: generation.provider })
    .from(generation)
    .where(gte(generation.createdAt, from30))

  return {
    totals: {
      users: totalsRow?.users ?? 0,
      active7d: totalsRow?.active7d ?? 0,
      suspended: totalsRow?.suspended ?? 0,
      admins: totalsRow?.admins ?? 0,
    },
    generations30d: gen30?.generations ?? 0,
    tokens30d: gen30?.tokens ?? 0,
    ocrExtractions: ocr?.n ?? 0,
    signupsPerDay: build30dSignups(now, signups),
    generationsPerDay: build30dGenerations(now, gensForSeries),
  }
}

function build30dSignups(
  now: Date,
  rows: { createdAt: Date }[],
): AdminStatsResponse['signupsPerDay'] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const key = localDayKey(r.createdAt)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const out: AdminStatsResponse['signupsPerDay'] = []
  for (let i = 29; i >= 0; i--) {
    const key = localDayKey(localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - i))
    out.push({ date: key, count: byDay.get(key) ?? 0 })
  }
  return out
}

function build30dGenerations(
  now: Date,
  rows: { createdAt: Date; provider: string | null }[],
): AdminStatsResponse['generationsPerDay'] {
  const byDay = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const key = localDayKey(r.createdAt)
    const provider = r.provider ?? 'unknown'
    const inner = byDay.get(key) ?? new Map<string, number>()
    inner.set(provider, (inner.get(provider) ?? 0) + 1)
    byDay.set(key, inner)
  }
  const out: AdminStatsResponse['generationsPerDay'] = []
  for (let i = 29; i >= 0; i--) {
    const key = localDayKey(localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - i))
    const inner = byDay.get(key)
    const byProvider: Record<string, number> = {}
    let total = 0
    if (inner) {
      for (const [provider, n] of inner) {
        byProvider[provider] = n
        total += n
      }
    }
    out.push({ date: key, total, byProvider })
  }
  return out
}

/** The set of provider labels the web legend may see (known ids + 'unknown'). */
export const STAT_PROVIDERS = [...adminKnownProviders, 'unknown']
