import { z } from 'zod'
import {
  apiErrorSchema,
  healthResponseSchema,
  reviewPreviewSchema,
  reviewQueueResponseSchema,
  reviewResultSchema,
  type ApiErrorCode,
  type HealthResponse,
  type ReviewCard,
  type ReviewPreview,
  type ReviewQueueResponse,
  type ReviewResult,
} from '@engram/shared'

/**
 * Thin typed API client (spec §1.3). Prefixes `/api` (proxied to the Hono
 * server), sends/receives JSON, throws `ApiError` on a non-2xx response, and
 * parses every success body through the shared Zod schema — the contract is
 * validated on the client too, so `@engram/shared` stays the single source of
 * truth and we never trust an unvalidated shape (quality gate #3).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | undefined
  /** Optional structured payload the server attaches (e.g. an upstream status). */
  readonly details: unknown

  constructor(status: number, message: string, code?: ApiErrorCode, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.safeParse(await res.json())
    if (parsed.success) {
      return new ApiError(
        res.status,
        parsed.data.error.message,
        parsed.data.error.code,
        parsed.data.error.details,
      )
    }
  } catch {
    // fall through to a generic message
  }
  return new ApiError(res.status, `HTTP ${res.status}`)
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Schema for the success body. Omit for `204 No Content`. */
  schema?: z.ZodType<T>
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal } = opts
  const init: RequestInit = { method }
  // Headers are built UNCONDITIONALLY (audit §9): a GET/DELETE/upload used to
  // leave `init.headers` undefined, so a merged `Authorization` would be lost and
  // every read would 401. Content-Type is only for JSON (never for FormData —
  // the browser sets the multipart boundary), but auth is added for ALL methods.
  const headers: Record<string, string> = {}
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  Object.assign(headers, authHeader())
  init.headers = headers
  if (signal) init.signal = signal
  const res = await fetch(`/api${path}`, init)
  if (res.status === 401) {
    // A dead/absent session mid-use → sign out + navigate to /login (audit §8).
    onUnauthorized()
    throw await toApiError(res)
  }
  if (!res.ok) {
    const err = await toApiError(res)
    // A newly-suspended account mid-use (IAM, amendment A3): route to the
    // dedicated "account suspended" screen instead of letting every query fail
    // silently. `/api/me` still 200s, so the screen can explain the lockout.
    if (res.status === 403 && err.code === 'suspended') onSuspended()
    throw err
  }
  if (res.status === 204 || !schema) return undefined as T
  return schema.parse(await res.json())
}

/**
 * Auth hooks, injected once at bootstrap (main.tsx) to keep this module free of
 * a Supabase dependency. `authHeader` returns `{ Authorization }` when a token
 * exists; `onUnauthorized` handles a 401 (signOut + navigate + clear).
 */
let authHeader: () => Record<string, string> = () => ({})
let onUnauthorized: () => void = () => {}
let onSuspended: () => void = () => {}

export function configureAuth(opts: {
  getAccessToken: () => string | null
  onUnauthorized: () => void
  /** Called once when a request 403s with code `suspended` (IAM, amendment A3). */
  onSuspended?: () => void
}): void {
  authHeader = () => {
    const token = opts.getAccessToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
  onUnauthorized = opts.onUnauthorized
  onSuspended = opts.onSuspended ?? (() => {})
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) =>
    request<T>(path, signal ? { schema, signal } : { schema }),
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'POST', body, schema }),
  patch: <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'PATCH', body, schema }),
  /** Write-only PUT (e.g. an API key): sends `body`, expects `204` (no schema). */
  put: (path: string, body: unknown) => request<void>(path, { method: 'PUT', body }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  /** DELETE that returns (and validates) a body — e.g. the admin GDPR delete result. */
  deleteWith: <T>(path: string, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'DELETE', schema }),
  /** Multipart POST (file upload). `body` is a `FormData`; parsed via `schema`. */
  upload: <T>(path: string, body: FormData, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'POST', body, schema }),
}

/** Build a query string from defined params only. */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of entries) sp.set(k, String(v))
  return `?${sp.toString()}`
}

/** Fetch + validate `GET /api/health` (kept from Phase 0). */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api.get('/health', healthResponseSchema, signal)
}

/** Review-session scope filters (at most one is set in practice). */
export interface ReviewScope {
  deckId?: string
  subjectId?: string
}

/**
 * The frozen review queue (spec §13.4). `now` freezes the lot; `limit` bounds it
 * (500 for a session, 1 for the "review again" probe). Parses the shared schema.
 */
export function fetchReviewQueue(
  params: ReviewScope & { now: string; limit: number },
  signal?: AbortSignal,
): Promise<ReviewQueueResponse> {
  return api.get(`/review/queue${qs({ ...params })}`, reviewQueueResponseSchema, signal)
}

/** Projected intervals of the 4 grades for a card at `now` (spec §13.4). */
export function fetchCardPreview(
  cardId: string,
  now: string,
  signal?: AbortSignal,
): Promise<ReviewPreview> {
  return api.get(`/cards/${cardId}/preview${qs({ now })}`, reviewPreviewSchema, signal)
}

/**
 * Submit a grade (spec §13.4). Not idempotent — each call advances FSRS and
 * inserts a `review_log`; the caller awaits this ack before advancing. Propagates
 * `ApiError.status` so a 404 (card deleted in parallel) becomes RATE_SKIP.
 */
export function postReview(cardId: string, body: ReviewCard): Promise<ReviewResult> {
  return api.post(`/cards/${cardId}/review`, body, reviewResultSchema)
}
