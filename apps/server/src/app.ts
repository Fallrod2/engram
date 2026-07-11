import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { healthResponseSchema, type HealthResponse } from '@engram/shared'
import { ApiError } from './http/errors'
import { subjectsRouter } from './routes/subjects'
import { decksRouter } from './routes/decks'
import { cardsRouter } from './routes/cards'
import { reviewRouter } from './routes/review'

/**
 * The Hono application, exported without a server binding so it can be
 * exercised directly in tests via `app.request(...)`.
 */
export const app = new Hono()

// Localhost dev: web (:5173) talks to the server (:3001) cross-origin.
app.use('/api/*', cors({ origin: 'http://localhost:5173' }))

app.get('/api/health', (c) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'engram-server',
    timestamp: new Date().toISOString(),
  }
  // Validate against the shared contract before it leaves the server.
  return c.json(healthResponseSchema.parse(body))
})

app.route('/api/subjects', subjectsRouter)
app.route('/api/decks', decksRouter)
app.route('/api/cards', cardsRouter) // includes POST /:id/review, GET /:id/preview
app.route('/api/review', reviewRouter) // /queue, /counts

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toResponse(), err.status as 400 | 404 | 409)
  }
  // A ZodError here = an OUTPUT `.parse` failed => a server bug (invalid DTO) =>
  // 500, never leaked.
  if (err instanceof ZodError) {
    console.error('output schema violation', err.flatten())
    return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500)
  }
  console.error(err)
  return c.json({ error: { code: 'internal_error', message: 'internal server error' } }, 500)
})
