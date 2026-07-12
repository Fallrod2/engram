import type { Context } from 'hono'
import type { ZodSchema, infer as ZInfer } from 'zod'

/**
 * Validate a DTO against its shared schema before it leaves the server. A DTO
 * that drifts from the contract throws a `ZodError`, caught by `onError` as a
 * (non-leaking) 500 — an anti-drift guard that also runs in production.
 */
export const ok = <S extends ZodSchema>(c: Context, schema: S, dto: ZInfer<S>, status = 200) =>
  c.json(schema.parse(dto), status as 200 | 201 | 202)
