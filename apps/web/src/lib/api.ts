import { z } from 'zod'
import {
  apiErrorSchema,
  cardSchema,
  demoSeedStatusResponseSchema,
  demoSessionResponseSchema,
  hardestCardsResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  reviewPreviewSchema,
  reviewQueueResponseSchema,
  reviewResultSchema,
  undoReviewResponseSchema,
  type ApiErrorCode,
  type Card,
  type DemoSeedStatusResponse,
  type DemoSessionResponse,
  type HardestCardsResponse,
  type HealthResponse,
  type MeResponse,
  type ReviewCard,
  type ReviewPreview,
  type ReviewQueueResponse,
  type ReviewResult,
  type UndoReview,
  type UndoReviewResponse,
  type UpdateCard,
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
  /**
   * Bearer token to use INSTEAD of the ambient one from the auth store. Set by
   * exactly one caller — the demo boot sequence, which fires its first two
   * authenticated requests in the moment right after `supabase.auth.setSession`,
   * before the store has necessarily observed the `SIGNED_IN` event. Passing the
   * token we were just handed removes that race entirely instead of polling the
   * store until it catches up. Everything else must keep using the ambient token.
   */
  accessToken?: string
}

async function request<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', body, schema, signal, accessToken } = opts
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
  Object.assign(headers, accessToken ? { Authorization: `Bearer ${accessToken}` } : authHeader())
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
  /** PUT that returns (and validates) a body — e.g. replacing a group's permissions. */
  putWith: <T>(path: string, body: unknown, schema: z.ZodType<T>) =>
    request<T>(path, { method: 'PUT', body, schema }),
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

/**
 * Open a session on the public demo account (`POST /api/demo/session`, landing
 * CTA). Deliberately takes NO argument and sends NO body: the credentials live in
 * the server environment only, and the route ignores anything posted to it. The
 * returned token pair is handed straight to `supabase.auth.setSession`.
 */
export function createDemoSession(): Promise<DemoSessionResponse> {
  return api.post('/demo/session', undefined, demoSessionResponseSchema)
}

/**
 * FIRE the demo seed and wait for it (`GET /api/me` with the freshly minted
 * token). Not a probe — a normal authenticated request, and that is the whole
 * point: the server's demo middleware seeds the account on the first
 * authenticated request that is NOT `GET /api/demo/status`, and it awaits the
 * seeding transaction before handing the request to the router. So this call
 * RESOLVING is the authoritative "the dataset is committed" signal; nothing
 * about it is inferred.
 *
 * `/api/me` is picked because the app needs it anyway — the caller writes the
 * answer straight into the query cache, so the wait costs no extra round trip.
 */
export function primeDemoAccount(accessToken: string, signal?: AbortSignal): Promise<MeResponse> {
  return request('/me', { schema: meResponseSchema, accessToken, ...(signal ? { signal } : {}) })
}

/**
 * Read how far the demo seed has got, for the caller's own session
 * (`GET /api/demo/status`). Purely informational: `primeDemoAccount` is what
 * waits, this is what lets the waiting screen say something TRUE meanwhile —
 * `pending` (the seed has not started: we are still paying the cold start or the
 * network), `seeding` (the server holds the seed's advisory lock right now),
 * `ready` (committed). The server exempts this route from the seeding
 * middleware, so polling it neither triggers a seed nor queues behind one.
 */
export function fetchDemoSeedStatus(
  accessToken: string,
  signal?: AbortSignal,
): Promise<DemoSeedStatusResponse> {
  return request('/demo/status', {
    schema: demoSeedStatusResponseSchema,
    accessToken,
    ...(signal ? { signal } : {}),
  })
}

/**
 * The `limit` hardest cards OF EACH SUBJECT (`GET /api/analytics/hardest-cards`).
 * Ranked on the FSRS `difficulty` the scheduler already maintains; the server
 * drops never-reviewed cards (`difficulty = 0` = unknown, not easy) and anything
 * under the `minReps` it echoes back. Not window-scoped: difficulty is a current
 * state, not an aggregate over a period.
 *
 * With `subjectId` the ranking narrows to that one subject, and `limit` — a
 * per-subject bound — becomes the total, which is what the Subject screen wants.
 */
export function fetchHardestCards(
  limit: number,
  signal?: AbortSignal,
  subjectId?: string,
): Promise<HardestCardsResponse> {
  return api.get(
    `/analytics/hardest-cards${qs({ limit, subjectId })}`,
    hardestCardsResponseSchema,
    signal,
  )
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

/**
 * Unwind the last review of a card (`POST /api/cards/:id/review/undo`). `logId`
 * is the id `postReview` returned for the very review being undone: the server
 * only accepts it while that log is STILL the card's last one, which makes the
 * call naturally idempotent — a replay 409s instead of unwinding a second
 * review. Every refusal (stale log, double undo, outside the server's window)
 * comes back as a 409, so the client treats any error as DEFINITIVE: no retry.
 */
export function postUndoReview(cardId: string, body: UndoReview): Promise<UndoReviewResponse> {
  return api.post(`/cards/${cardId}/review/undo`, body, undoReviewResponseSchema)
}

/**
 * Edit a card's content (`PATCH /api/cards/:id`, shared `updateCardSchema`).
 * Writes `front`/`back` only — the FSRS columns are the scheduler's, written
 * exclusively by `postReview`, so an edit and a grade never race on the same
 * columns even back to back.
 */
export function updateCard(cardId: string, patch: UpdateCard): Promise<Card> {
  return api.patch(`/cards/${cardId}`, patch, cardSchema)
}
