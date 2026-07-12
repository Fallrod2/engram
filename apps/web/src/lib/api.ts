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

  constructor(status: number, message: string, code?: ApiErrorCode) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.safeParse(await res.json())
    if (parsed.success) {
      return new ApiError(res.status, parsed.data.error.message, parsed.data.error.code)
    }
  } catch {
    // fall through to a generic message
  }
  return new ApiError(res.status, `HTTP ${res.status}`)
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Schema for the success body. Omit for `204 No Content`. */
  schema?: z.ZodType<T>
  signal?: AbortSignal
}

async function request<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal } = opts
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  if (signal) init.signal = signal
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204 || !schema) return undefined as T
  return schema.parse(await res.json())
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal) =>
    request<T>(path, signal ? { schema, signal } : { schema }),
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'POST', body, schema }),
  patch: <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'PATCH', body, schema }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
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
