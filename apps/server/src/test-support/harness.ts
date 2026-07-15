import { createEmptyCard } from 'ts-fsrs'
import type { DB } from '../db/client'
import {
  adminAudit,
  aiCredential,
  appSettings,
  card,
  deck,
  exam,
  examSubject,
  generation,
  groupMember,
  groupPermission,
  note,
  reviewLog,
  subject,
  userGroup,
  userProfile,
} from '../db/schema'
import type { AdminPermission, UserRole, UserStatus } from '@engram/shared'
import { fsrsCardToColumns } from '../db/mappers'
import { localMidnight } from '../lib/day'
import { DEFAULT_DEV_USER_ID } from '../auth/config'

/**
 * Default owner for seeded rows. MUST match the identity the auth middleware
 * poses when the gate is not enforced (bun:test runs with no auth env), so that
 * `app.request(...)` route specs — scoped to that same id — see the seeded data
 * (critique amendment 2). Isolation specs override `userId` per seed to create
 * distinct tenants.
 */
export { DEFAULT_DEV_USER_ID }

/**
 * Shared async seeding/reset helpers for the integration specs. All functions
 * take an explicit `db` so they work both against a per-test `createTestDb()`
 * handle and against the singleton used by the route specs.
 */

/** Delete every row (child tables first) so each test starts clean. */
export async function resetDb(db: DB): Promise<void> {
  await db.delete(examSubject)
  await db.delete(exam)
  await db.delete(reviewLog)
  await db.delete(card)
  await db.delete(generation)
  await db.delete(note)
  await db.delete(deck)
  await db.delete(subject)
  // Standalone config tables (no FKs) — reset so AI config never leaks between
  // specs sharing the preloaded PGlite database.
  await db.delete(appSettings)
  await db.delete(aiCredential)
  // RBAC group tables (rbac-groups §2): children BEFORE the parent (FK-safe).
  await db.delete(groupPermission)
  await db.delete(groupMember)
  await db.delete(userGroup)
  // IAM tables (spec §5.1). NOTE: the profile middleware RECREATES a caller's
  // profile lazily during a route spec — seed AFTER resetDb, and never assert a
  // profile COUNT without accounting for that lazy creation (amendment A9).
  await db.delete(adminAudit)
  await db.delete(userProfile)
}

/** Seed a `user_group` row (rbac-groups §5 helper). Returns the created group. */
export async function seedGroup(db: DB, o: { name?: string; description?: string | null } = {}) {
  const [row] = await db
    .insert(userGroup)
    .values({ name: o.name ?? 'Group', description: o.description ?? null })
    .returning()
  return row!
}

/** Add a user to a group (composite PK). */
export async function seedGroupMember(db: DB, groupId: string, userId: string) {
  const [row] = await db.insert(groupMember).values({ groupId, userId }).returning()
  return row!
}

/** Grant a permission to a group (composite PK). */
export async function seedGroupPermission(db: DB, groupId: string, permission: AdminPermission) {
  const [row] = await db.insert(groupPermission).values({ groupId, permission }).returning()
  return row!
}

/**
 * Seed a `user_profile` row directly (spec §5 helper). Defaults to a plain active
 * user; override role/status/isDemo to exercise the IAM guards. `lastSeenAt`
 * defaults to now so the lazy middleware treats it as fresh (no touch write).
 */
export async function seedUserProfile(
  db: DB,
  o: {
    userId: string
    email?: string | null
    role?: UserRole
    status?: UserStatus
    isDemo?: boolean
    createdAt?: Date
    lastSeenAt?: Date
  },
) {
  const now = new Date()
  const [row] = await db
    .insert(userProfile)
    .values({
      userId: o.userId,
      email: o.email ?? null,
      role: o.role ?? 'user',
      status: o.status ?? 'active',
      isDemo: o.isDemo ?? false,
      createdAt: o.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: o.lastSeenAt ?? now,
    })
    .returning()
  return row!
}

export async function seedSubject(
  db: DB,
  o: {
    name?: string
    color?: string
    icon?: string
    archived?: boolean
    position?: number
    userId?: string
  } = {},
) {
  const [row] = await db
    .insert(subject)
    .values({
      userId: o.userId ?? DEFAULT_DEV_USER_ID,
      name: o.name ?? 'Subject',
      color: o.color ?? '#3b82f6',
      icon: o.icon ?? 'book',
      ...(o.archived !== undefined ? { archived: o.archived } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
  return row!
}

export async function seedDeck(
  db: DB,
  subjectId: string,
  o: { name?: string; description?: string; position?: number; userId?: string } = {},
) {
  const [row] = await db
    .insert(deck)
    .values({
      userId: o.userId ?? DEFAULT_DEV_USER_ID,
      subjectId,
      name: o.name ?? 'Deck',
      ...(o.description !== undefined ? { description: o.description } : {}),
      ...(o.position !== undefined ? { position: o.position } : {}),
    })
    .returning()
  return row!
}

export async function seedCard(
  db: DB,
  deckId: string,
  o: { front?: string; back?: string; due?: Date; userId?: string } = {},
) {
  const cols = fsrsCardToColumns(createEmptyCard(new Date()))
  const [row] = await db
    .insert(card)
    .values({
      userId: o.userId ?? DEFAULT_DEV_USER_ID,
      deckId,
      front: o.front ?? '# Q',
      back: o.back ?? '# A',
      ...cols,
      ...(o.due !== undefined ? { due: o.due } : {}),
    })
    .returning()
  return row!
}

/**
 * Insert a review_log row directly (bypassing FSRS) so tests can drive
 * `state`/`rating`/`review`/`durationMs` freely. FSRS-only columns are 0 (the
 * analytics domain reads none of them). `durationMs` omitted → NULL column
 * (lets tests exercise the "not measured ≠ 0" contract).
 */
export async function seedReviewLog(
  db: DB,
  cardId: string,
  o: {
    rating?: number
    state?: number
    review?: Date
    durationMs?: number | null
    userId?: string
  } = {},
) {
  const when = o.review ?? new Date()
  const [row] = await db
    .insert(reviewLog)
    .values({
      userId: o.userId ?? DEFAULT_DEV_USER_ID,
      cardId,
      rating: o.rating ?? 3,
      state: o.state ?? 2, // Review by default
      due: when,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      lastElapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      review: when,
      ...(o.durationMs !== undefined ? { durationMs: o.durationMs } : {}),
    })
    .returning()
  return row!
}

export async function seedExam(
  db: DB,
  subjectIds: string[],
  o: { title?: string; date?: Date; notes?: string; userId?: string } = {},
) {
  const now = new Date()
  const [row] = await db
    .insert(exam)
    .values({
      userId: o.userId ?? DEFAULT_DEV_USER_ID,
      title: o.title ?? 'Exam',
      date: o.date ?? localMidnight(now.getFullYear(), now.getMonth(), now.getDate()),
      ...(o.notes !== undefined ? { notes: o.notes } : {}),
    })
    .returning()
  for (const subjectId of [...new Set(subjectIds)]) {
    await db.insert(examSubject).values({ examId: row!.id, subjectId })
  }
  return row!
}
