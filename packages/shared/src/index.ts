import { z } from 'zod'

/**
 * `@engram/shared` is the single source of truth for the API contract.
 * Every request/response shape lives here as a Zod schema; server and web
 * both import the inferred types so they can never drift apart.
 */

/** Response of `GET /api/health`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('engram-server'),
  /** ISO-8601 timestamp, produced server-side. */
  timestamp: z.string().datetime(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export * from './domain'
export * from './backup'
