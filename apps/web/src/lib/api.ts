import { healthResponseSchema, type HealthResponse } from '@engram/shared'

/**
 * Fetch + validate `GET /api/health`.
 *
 * The response is parsed through the shared Zod schema so the app never trusts
 * an unvalidated shape — `@engram/shared` stays the single source of truth for
 * the API contract.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/health', signal ? { signal } : undefined)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return healthResponseSchema.parse(await res.json())
}
