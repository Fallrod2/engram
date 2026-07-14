import { and, asc, count, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm'
import type {
  AdminAuditResponse,
  AdminDeleteCounts,
  AdminDeleteUserResponse,
  AdminStatsResponse,
  AdminUserDetail,
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
  note,
  reviewLog,
  subject,
  userProfile,
} from '../db/schema'
import { localDayKey, localMidnight } from '../lib/day'
import { resolveAuthConfig } from '../auth/config'
import { ForbiddenError, NotFoundError } from '../http/errors'
import { wipeUserData } from './demo.service'
import {
  effectiveActiveAdminIds,
  getEmailsByIds,
  getProfile,
  wouldBeLastActiveAdmin,
} from './profile.service'

/**
 * The admin/IAM service (spec §3). Every WRITE is guarded (no self-demote/suspend/
 * delete, never the last effective active admin, demo never promoted, admin never
 * demo) AND audited in the SAME transaction as its effect — so the journal can
 * never disagree with reality. No response ever carries a secret or (in stored
 * audit rows) any PII (amendment A13): emails are joined only at read time.
 */

// --- Correlated per-user aggregates (secret-free) --------------------------
// Scalar subqueries keyed on the profile row. At the app's scale (a handful of
// users) this is well within budget and keeps sorting by an aggregate trivial.

const subjectsExpr =
  sql<number>`(select count(*) from ${subject} where ${subject.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const decksExpr =
  sql<number>`(select count(*) from ${deck} where ${deck.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const cardsExpr =
  sql<number>`(select count(*) from ${card} where ${card.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const notesExpr =
  sql<number>`(select count(*) from ${note} where ${note.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const reviewsExpr =
  sql<number>`(select count(*) from ${reviewLog} where ${reviewLog.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const generationsExpr =
  sql<number>`(select count(*) from ${generation} where ${generation.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )
const tokensExpr =
  sql<number>`(select coalesce(sum(coalesce(${generation.promptTokens}, 0) + coalesce(${generation.completionTokens}, 0)), 0) from ${generation} where ${generation.userId} = ${userProfile.userId})`.mapWith(
    Number,
  )

const SUMMARY_COLUMNS = {
  userId: userProfile.userId,
  email: userProfile.email,
  role: userProfile.role,
  status: userProfile.status,
  isDemo: userProfile.isDemo,
  createdAt: userProfile.createdAt,
  lastSeenAt: userProfile.lastSeenAt,
  subjects: subjectsExpr,
  cards: cardsExpr,
  notes: notesExpr,
  generations: generationsExpr,
  tokens: tokensExpr,
}

function toSummary(row: {
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
}): AdminUserSummary {
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
  }
}

/** Escape LIKE metacharacters so a literal `%`/`_` never widens the filter (A11). */
function searchClause(query: string | undefined): SQL | undefined {
  if (!query) return undefined
  const escaped = query.replace(/[\\%_]/g, (m) => `\\${m}`)
  const pattern = `%${escaped}%`
  return or(ilike(userProfile.email, pattern), ilike(userProfile.userId, pattern))
}

/** Map the closed sort enum to a concrete ORDER BY expression (never raw). */
function orderClause(sort: AdminUsersQuery['sort'], dir: AdminUsersQuery['dir']): SQL {
  const wrap = dir === 'asc' ? asc : desc
  switch (sort) {
    case 'createdAt':
      return wrap(userProfile.createdAt)
    case 'email':
      return wrap(userProfile.email)
    case 'cards':
      return wrap(cardsExpr)
    case 'tokens':
      return wrap(tokensExpr)
    case 'lastSeen':
    default:
      return wrap(userProfile.lastSeenAt)
  }
}

export async function listUsers(db: DB, params: AdminUsersQuery): Promise<AdminUsersResponse> {
  const where = searchClause(params.query)
  const [{ total }] = (await db.select({ total: count() }).from(userProfile).where(where)) as [
    { total: number },
  ]

  const pageSize = ADMIN_USERS_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(params.page, totalPages)
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(userProfile)
    .where(where)
    // Secondary key keeps pagination deterministic when the primary ties.
    .orderBy(orderClause(params.sort, params.dir), asc(userProfile.userId))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return { users: rows.map(toSummary), page, pageSize, total, totalPages }
}

export async function userDetail(db: DB, userId: string): Promise<AdminUserDetail> {
  const [row] = await db
    .select({ ...SUMMARY_COLUMNS, decks: decksExpr, reviews: reviewsExpr })
    .from(userProfile)
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

  return {
    ...toSummary(row),
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

/** UUID shape guard for the best-effort `auth.users` delete (amendment A6). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function deleteUser(
  db: DB,
  actorUserId: string,
  targetUserId: string,
): Promise<AdminDeleteUserResponse> {
  const cfg = resolveAuthConfig(process.env)
  if (targetUserId === actorUserId) throw new ForbiddenError('cannot delete yourself')

  let deletedCounts!: AdminDeleteCounts
  await db.transaction(async (tx) => {
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
  const [row] = await db
    .select(SUMMARY_COLUMNS)
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
  if (!row) throw new NotFoundError('user not found')
  return toSummary(row)
}

// --- Stats -----------------------------------------------------------------

export async function stats(db: DB): Promise<AdminStatsResponse> {
  const now = new Date()
  const from30 = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - 29)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000)

  const [totalsRow] = await db
    .select({
      users: count(),
      active7d:
        sql<number>`coalesce(sum(case when ${userProfile.lastSeenAt} >= ${sevenDaysAgo} then 1 else 0 end), 0)`.mapWith(
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
