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

/**
 * The delegated-administration permission set (rbac-groups §1.1, amendment A4.1).
 * `role='admin'` (and the env admin filet) hold ALL of these IMPLICITLY — they are
 * never stored on an admin. A `role='user'` gains a TARGETED subset via their
 * groups (`group_permission`) → delegated admin (a moderator = user + a group).
 *
 * `users.delete` is DELIBERATELY absent (amendment A4.1): a GDPR delete is
 * irreversible and stays a super-admin power (`DELETE /admin/users/:id` is
 * `requireAdmin`). Likewise `set-role`/`set-demo` have no permission — creating an
 * admin or the demo account stays `requireAdmin` (amendments A1/A5).
 *
 * ⚠️ This constant is the SINGLE source of truth AND the exact mirror of the
 * `group_permission` CHECK (migration 0009). Adding a permission REQUIRES: (1) a
 * new entry here, (2) a NEW migration widening that CHECK. The PGlite test
 * `group-permission CHECK mirrors ADMIN_PERMISSIONS` guards this drift.
 */
export const ADMIN_PERMISSIONS = [
  'users.view',
  'users.manage',
  'groups.manage',
  'audit.view',
  'stats.view',
] as const
export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS)
export type AdminPermission = z.infer<typeof adminPermissionSchema>

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
  /**
   * The caller's EFFECTIVE permissions (rbac-groups §3, amendment C3). ALL of
   * `ADMIN_PERMISSIONS` for an admin / env-admin (even a bypass env-admin whose DB
   * role is 'user'), else the union of their groups' permissions. The web guards
   * `/admin` on `isAdmin || permissions.length > 0` and mirrors each tab/action —
   * the SERVER stays the sole authority.
   */
  permissions: z.array(z.string()),
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

/** A compact reference to a group the user belongs to (rbac-groups §4). */
export const adminUserGroupRefSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type AdminUserGroupRef = z.infer<typeof adminUserGroupRefSchema>

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
  /** Groups this user belongs to (rbac-groups §4, additive) — chips + quick manage. */
  groups: z.array(adminUserGroupRefSchema),
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

// --- Account CRUD (spec §2, GoTrue Admin API) ------------------------------

/**
 * Create a user account (spec §2, amendments A1/A2/A10). A DISCRIMINATED UNION on
 * `mode` makes the password branch the ONLY shape that carries a `password`:
 *  - `mode='invite'` → GoTrue emails a magic link; the user lands on /set-password
 *    (existing flow). The server NEVER handles a password.
 *  - `mode='password'` → the admin supplies a temporary password (min 8), sent to
 *    GoTrue over TLS with `email_confirm:true`. It is NEVER logged/audited/echoed.
 *
 * `role` defaults to `'user'` (a body without `role` can NEVER create an admin —
 * amendment A2). `groupIds` is validated to exist server-side BEFORE the GoTrue
 * call (amendment A8) and gated by `groups.manage` at the route (amendment A1).
 */
const accountFields = {
  email: z.string().trim().email().max(255),
  role: userRoleSchema.default('user'),
  groupIds: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
}

export const adminCreateUserSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('invite'), ...accountFields }),
  z.object({ mode: z.literal('password'), password: z.string().min(8).max(72), ...accountFields }),
])
export type AdminCreateUser = z.infer<typeof adminCreateUserSchema>

/** Edit an existing account's email (spec §2, amendment A11). GoTrue is the unicity authority. */
export const adminUpdateUserSchema = z.object({
  email: z.string().trim().email().max(255),
})
export type AdminUpdateUser = z.infer<typeof adminUpdateUserSchema>

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

/**
 * Every audited write action (spec §1.2 + rbac-groups §4). The `group.*` actions
 * MUST be in this enum BEFORE any group write is journaled (amendment B1): the
 * audit read validates each row against this schema (`ok(...)` → `parse`), so an
 * unknown action would throw a ZodError → 500 on `GET /admin/audit`.
 */
export const adminAuditActionSchema = z.enum([
  'role.promote',
  'role.demote',
  'status.suspend',
  'status.reactivate',
  'demo.set',
  'demo.unset',
  // Account CRUD (spec §2, amendment A4) — MUST be present BEFORE the first
  // `writeAudit(...,'user.create'/'user.update',...)` or the audit read 500s.
  'user.create',
  'user.update',
  'user.invite.resend',
  'user.delete',
  'group.create',
  'group.update',
  'group.delete',
  'group.permissions',
  'group.member.add',
  'group.member.remove',
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

// --- Groups (delegated administration, rbac-groups §4) ---------------------

/** One group row: identity + member count + granted permissions. */
export const adminGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int(),
  permissions: z.array(adminPermissionSchema),
  createdAt: z.string().datetime(),
})
export type AdminGroup = z.infer<typeof adminGroupSchema>

export const adminGroupsResponseSchema = z.object({
  groups: z.array(adminGroupSchema),
})
export type AdminGroupsResponse = z.infer<typeof adminGroupsResponseSchema>

/** One member of a group (id + resolved email for display). */
export const adminGroupMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
})
export type AdminGroupMember = z.infer<typeof adminGroupMemberSchema>

export const adminGroupMembersResponseSchema = z.object({
  members: z.array(adminGroupMemberSchema),
})
export type AdminGroupMembersResponse = z.infer<typeof adminGroupMembersResponseSchema>

/** Create body. `name` non-empty (mirrors the DB CHECK), unique case-insensitively. */
export const adminCreateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
})
export type AdminCreateGroup = z.infer<typeof adminCreateGroupSchema>

/** Patch body: rename and/or reset the description (null clears it). */
export const adminUpdateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'at least one field is required',
  })
export type AdminUpdateGroup = z.infer<typeof adminUpdateGroupSchema>

/**
 * Replace a group's permission set (rbac-groups §4, `requireAdmin` — amendment
 * A2). Primary validation is HERE (⊂ ADMIN_PERMISSIONS); the DB CHECK is only a
 * backstop (amendment D2.3). Deduped server-side before the write.
 */
export const adminSetGroupPermissionsSchema = z.object({
  permissions: z.array(adminPermissionSchema),
})
export type AdminSetGroupPermissions = z.infer<typeof adminSetGroupPermissionsSchema>

/** Add a member by user id (the `sub`; a free-text string, never a physical FK). */
export const adminAddMemberSchema = z.object({
  userId: z.string().trim().min(1).max(255),
})
export type AdminAddMember = z.infer<typeof adminAddMemberSchema>

/** Path params for a member sub-route: the group `id` + the member `userId`. */
export const adminGroupMemberParamSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
})
export type AdminGroupMemberParam = z.infer<typeof adminGroupMemberParamSchema>

/** `DELETE /admin/groups/:id` acknowledgement. */
export const adminGroupDeleteResponseSchema = z.object({ deleted: z.literal(true) })
export type AdminGroupDeleteResponse = z.infer<typeof adminGroupDeleteResponseSchema>
