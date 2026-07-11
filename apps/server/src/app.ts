import { Hono } from 'hono'
import { healthResponseSchema, type HealthResponse } from '@engram/shared'

/**
 * The Hono application, exported without a server binding so it can be
 * exercised directly in tests via `app.request(...)`.
 */
export const app = new Hono()

app.get('/api/health', (c) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'engram-server',
    timestamp: new Date().toISOString(),
  }
  // Validate against the shared contract before it leaves the server.
  return c.json(healthResponseSchema.parse(body))
})
