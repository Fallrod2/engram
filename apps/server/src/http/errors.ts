import type { ApiErrorResponse, ApiErrorCode } from '@engram/shared'

/**
 * Typed API errors. Every handler throws one of these (or lets an unexpected
 * error bubble to `onError`, which renders a non-leaking 500). `toResponse`
 * produces the single error envelope defined in `@engram/shared`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }

  toResponse(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    }
  }
}

/** 400 — invalid input (Zod, or a domain guard such as an incoherent `reviewedAt`). */
export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(400, 'validation_error', message, details)
  }
}

/** 401 — access token absent, malformed, invalid or expired (auth gate). */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, 'unauthorized', message)
  }
}

/** 403 — authenticated but not permitted (admin-only route, spec §3). */
export class ForbiddenError extends ApiError {
  constructor(message: string) {
    super(403, 'forbidden', message)
  }
}

/**
 * 403 — the account is suspended (IAM, spec §2.1 / amendment A15). A distinct
 * code from `forbidden` so the web can route to the dedicated "account suspended"
 * screen (via the api client's `onSuspended` hook) instead of a generic error.
 */
export class SuspendedError extends ApiError {
  constructor(message = 'account suspended') {
    super(403, 'suspended', message)
  }
}

/** 404 — the path resource, or a foreign id referenced in the body, does not exist. */
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, 'not_found', message)
  }
}

/** 409 — a state conflict (e.g. creating under an archived subject). */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, 'conflict', message)
  }
}

/**
 * 409 — account CRUD: the email is already registered (spec §2, amendment A3/A8).
 * GoTrue is the sole unicity authority (`user_profile.email` is NOT unique); this
 * distinct code lets the web show a dedicated toast ("Cet email est déjà pris").
 */
export class EmailTakenError extends ApiError {
  constructor(message = 'this email is already registered') {
    super(409, 'email_taken', message)
  }
}

/**
 * 503 — account creation/edit is unavailable because SUPABASE_URL + the
 * service_role key are not configured (dev bypass, tests, prod without the key —
 * amendment A6). A clean, non-crashing degrade with a dedicated code the web maps
 * to "Configure Supabase pour créer des comptes".
 */
export class AccountMgmtUnavailableError extends ApiError {
  constructor() {
    super(
      503,
      'account_mgmt_unavailable',
      'La création de comptes nécessite la configuration Supabase — indisponible dans cet environnement.',
    )
  }
}

/** 400 — account CRUD: GoTrue rejected the email as malformed (amendment A3). */
export class InvalidEmailError extends ApiError {
  constructor(message = 'invalid email address') {
    super(400, 'invalid_email', message)
  }
}

/** 413 — an uploaded file exceeds the size limit. */
export class PayloadTooLargeError extends ApiError {
  constructor(message: string) {
    super(413, 'payload_too_large', message)
  }
}

/** 502 — a trusted upstream refused or failed (e.g. OpenAI device-code initiation). */
export class UpstreamError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(502, 'upstream_error', message, details)
  }
}

/** 503 — a feature is unavailable (e.g. AI generation with no API key configured). */
export class ServiceUnavailableError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(503, 'service_unavailable', message, details)
  }
}
