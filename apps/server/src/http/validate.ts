import { zValidator as base } from '@hono/zod-validator'
import type { ZodSchema } from 'zod'
import { toValidationResponse } from './errors-format'

type Target = 'json' | 'query' | 'param'

/**
 * `@hono/zod-validator` wrapped so a validation failure emits the project's
 * single error envelope (400) instead of Hono's default body.
 */
export const zValidator = <T extends ZodSchema>(target: Target, schema: T) =>
  base(target, schema, (result, c) => {
    if (!result.success) return c.json(toValidationResponse(result.error), 400)
    return undefined
  })
