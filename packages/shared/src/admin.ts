import { z } from 'zod'
import { aiProviderIdSchema } from './domain'

/**
 * IAM / admin contract (spec §2/§3). Single source of truth for the `/api/me`
 * identity probe and every `/api/admin/*` shape. Server and web both import the
 * inferred types so the admin console can never drift from the API.
 *
 * SECURITY: no schema here ever carries a secret — provider keys/tokens are NEVER
 * joined into a user summary/detail, and audit `details` holds ids + counts +
 * state values only (amendment A13), never PII.
 */

/** The two roles (spec §1.1). No granular RBAC in v1. */
export const userRoleSchema = z.enum(['admin', 'user'])
export type UserRole = z.infer<typeof userRoleSchema>

/** Account status (spec §1.1). `suspended` → 403 `suspended` on every /api/*. */
export const userStatusSchema = z.enum(['active', 'suspended'])
export type UserStatus = z.infer<typeof userStatusSchema>

// --- GET /api/me (authenticated identity probe, spec §2.3) -----------------

/**
 * The caller's own identity. Consumed by the web guard + conditional nav + the
 * "account suspended" screen. A SUSPENDED caller still gets a 200 here (amendment
 * A3) so the front can explain *why* it is locked out — every other route 403s.
 */
export const meResponseSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  isAdmin: z.boolean(),
  isDemo: z.boolean(),
  status: userStatusSchema,
})
export type MeResponse = z.infer<typeof meResponseSchema>

// --- GET /api/admin/users (paginated list + compact usage) -----------------

/** Server-fixed page size for the admin user list (no client-controlled limit). */
export const ADMIN_USERS_PAGE_SIZE = 50

/** Closed sort enum → mapped IN CODE to Drizzle columns (amendment A11, no raw). */
export const adminUsersSortSchema = z.enum(['lastSeen', 'createdAt', 'email', 'cards', 'tokens'])
export type AdminUsersSort = z.infer<typeof adminUsersSortSchema>

export const adminUsersQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  sort: adminUsersSortSchema.default('lastSeen'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>

/** One row of the admin user table: profile + compact cross-user usage counts. */
export const adminUserSummarySchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  isDemo: z.boolean(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  subjects: z.number().int(),
  cards: z.number().int(),
  notes: z.number().int(),
  generations: z.number().int(),
  tokens: z.number().int(),
})
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>

// --- GET /api/admin/users/:id (detailed usage) -----------------------------

/** Per-provider generation totals (secret-free — provider label + counts only). */
export const adminProviderUsageSchema = z.object({
  provider: z.string(), // provider id, or 'unknown' for pre-multi-provider rows
  generations: z.number().int(),
  tokens: z.number().int(),
})
export type AdminProviderUsage = z.infer<typeof adminProviderUsageSchema>

/** One day of a user's recent activity (last 30 days, dense is not required). */
export const adminActivityPointSchema = z.object({
  date: z.string(), // local day key YYYY-MM-DD
  generations: z.number().int(),
  reviews: z.number().int(),
})
export type AdminActivityPoint = z.infer<typeof adminActivityPointSchema>

export const adminUserDetailSchema = adminUserSummarySchema.extend({
  decks: z.number().int(),
  reviews: z.number().int(),
  byProvider: z.array(adminProviderUsageSchema),
  activity30d: z.array(adminActivityPointSchema),
})
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>

// --- Write bodies (each audited server-side) -------------------------------

export const adminSetRoleSchema = z.object({ role: userRoleSchema })
export const adminSetStatusSchema = z.object({ status: userStatusSchema })
export const adminSetDemoSchema = z.object({ isDemo: z.boolean() })
export type AdminSetRole = z.infer<typeof adminSetRoleSchema>
export type AdminSetStatus = z.infer<typeof adminSetStatusSchema>
export type AdminSetDemo = z.infer<typeof adminSetDemoSchema>

/** Counts removed by a full GDPR delete, surfaced for the audit + the toast. */
export const adminDeleteCountsSchema = z.object({
  subjects: z.number().int(),
  decks: z.number().int(),
  cards: z.number().int(),
  reviewLogs: z.number().int(),
  notes: z.number().int(),
  generations: z.number().int(),
  exams: z.number().int(),
  appSettings: z.number().int(),
  aiCredentials: z.number().int(),
})
export type AdminDeleteCounts = z.infer<typeof adminDeleteCountsSchema>

/**
 * Result of `DELETE /api/admin/users/:id`. `authDeleted:false` is the honest
 * signal that the GoTrue `auth.users` row could NOT be removed (PGlite/local, or
 * a non-uuid sub, or the auth schema absent) — the public data is gone regardless
 * but the login was not revoked (amendment A6).
 */
export const adminDeleteUserResponseSchema = z.object({
  authDeleted: z.boolean(),
  deletedCounts: adminDeleteCountsSchema,
})
export type AdminDeleteUserResponse = z.infer<typeof adminDeleteUserResponseSchema>

// --- GET /api/admin/stats (instance overview) ------------------------------

export const adminStatsTotalsSchema = z.object({
  users: z.number().int(),
  active7d: z.number().int(),
  suspended: z.number().int(),
  admins: z.number().int(),
})

export const adminSignupPointSchema = z.object({
  date: z.string(),
  count: z.number().int(),
})

/** Generations for one day, split by provider for the stacked chart. */
export const adminGenerationPointSchema = z.object({
  date: z.string(),
  total: z.number().int(),
  /** provider id (or 'unknown') → count that day. */
  byProvider: z.record(z.string(), z.number().int()),
})

export const adminStatsResponseSchema = z.object({
  totals: adminStatsTotalsSchema,
  generations30d: z.number().int(),
  tokens30d: z.number().int(),
  ocrExtractions: z.number().int(),
  signupsPerDay: z.array(adminSignupPointSchema),
  generationsPerDay: z.array(adminGenerationPointSchema),
})
export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>

// --- GET /api/admin/audit (append-only journal, paginated) -----------------

export const ADMIN_AUDIT_PAGE_SIZE = 50

/** Every audited write action (spec §1.2). */
export const adminAuditActionSchema = z.enum([
  'role.promote',
  'role.demote',
  'status.suspend',
  'status.reactivate',
  'demo.set',
  'demo.unset',
  'user.delete',
])
export type AdminAuditAction = z.infer<typeof adminAuditActionSchema>

export const adminAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>

/**
 * One audit row. Emails are resolved by JOIN at read time (amendment A13) — the
 * stored row never persists PII, only ids + counts + `{from,to}` state values.
 */
export const adminAuditEntrySchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  actorEmail: z.string().nullable(),
  action: adminAuditActionSchema,
  targetUserId: z.string().nullable(),
  targetEmail: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
})
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>

export const adminAuditResponseSchema = z.object({
  entries: z.array(adminAuditEntrySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})
export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>

/** The known provider ids (for the web to label the stacked chart legend). */
export const adminKnownProviders = aiProviderIdSchema.options
