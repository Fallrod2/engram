import type { ZodError } from 'zod'
import type { ApiErrorResponse } from '@engram/shared'

/** A failed input `ZodError` → the single validation-error envelope (400 body). */
export function toValidationResponse(err: ZodError): ApiErrorResponse {
  return {
    error: {
      code: 'validation_error',
      message: 'Invalid request',
      details: err.flatten(),
    },
  }
}
