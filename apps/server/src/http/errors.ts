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
