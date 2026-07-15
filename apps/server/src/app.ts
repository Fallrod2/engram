import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { healthResponseSchema, type HealthResponse, type ApiErrorCode } from '@engram/shared'
import { ApiError } from './http/errors'
import { resolveAuthConfig } from './auth/config'
import { createAuthMiddleware } from './http/auth'
import { createProfileMiddleware } from './http/profile'
import { createDemoMiddleware } from './http/demo'
import { getCardGenerator, configuredGenerator } from './ai/generator'
import { subjectsRouter } from './routes/subjects'
import { decksRouter } from './routes/decks'
import { cardsRouter } from './routes/cards'
import { reviewRouter } from './routes/review'
import { notesRouter } from './routes/notes'
import { generationsRouter } from './routes/generations'
import { examsRouter } from './routes/exams'
import { studyPlanRouter } from './routes/study-plan'
import { analyticsRouter } from './routes/analytics'
import { backupRouter } from './routes/backup'
import { aiRouter } from './routes/ai'
import { meRouter } from './routes/me'
import { adminRouter } from './routes/admin'
import { groupsRouter } from './routes/groups'

/**
 * The Hono application, exported without a server binding so it can be
 * exercised directly in tests via `app.request(...)`.
 */
export const app = new Hono()

// Localhost dev: web (:5173) talks to the server (:3001) cross-origin.
app.use('/api/*', cors({ origin: 'http://localhost:5173' }))
// Auth gate (spec §2.6). Mounted AFTER cors (preflight handled first) and BEFORE
// the routers. It resolves its config PER REQUEST from `process.env` — nothing is
// read at this module's top level, so importing `app.ts` never throws (audit §6).
app.use('/api/*', createAuthMiddleware())
// IAM profile (spec §2.1). AFTER auth (needs `authClaims`) and BEFORE demo (which
// reads the resolved `is_demo`). Lazily upserts the caller's `user_profile`,
// stashes it in the context for the sync admin/demo guards, and enforces
// suspension (403 `suspended`, except GET /api/me + the env-admin filet).
app.use('/api/*', createProfileMiddleware())
// Demo-account reset (spec §4). AFTER the profile middleware (reads `is_demo`)
// and BEFORE the routers. No-op unless the caller is the demo account (profile
// flag OR `ENGRAM_DEMO_USER_ID`) — so prod/dev/e2e without one pay nothing.
app.use('/api/*', createDemoMiddleware())

app.get('/api/health', (c) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'engram-server',
    timestamp: new Date().toISOString(),
    // Reflects the RUNTIME generator, not just the env flag: if the fake-AI
    // wiring in index.ts ever fails to apply, this stays false and the e2e boot
    // guard aborts the run before any spec can trigger a real API call. Compared
    // against the new default (`configuredGenerator`), not the legacy Anthropic one.
    fakeAi: getCardGenerator() !== configuredGenerator,
    // Self-report of the gate. This call is PURE and never throws — the
    // fail-closed `misconfigured` case is judged ONLY by the middleware, so the
    // probe stays readable even on a prod misconfig (reports authEnforced:false).
    authEnforced: resolveAuthConfig(process.env).enforced,
    // Whether a demo account is wired (ENGRAM_DEMO_USER_ID). Read for the wave-2
    // landing CTA; never leaks the demo id itself. `false` in the current prod.
    demoEnabled: Boolean(process.env.ENGRAM_DEMO_USER_ID),
  }
  // Validate against the shared contract before it leaves the server.
  return c.json(healthResponseSchema.parse(body))
})

app.route('/api/subjects', subjectsRouter)
app.route('/api/decks', decksRouter)
app.route('/api/cards', cardsRouter) // includes POST /:id/review, GET /:id/preview
app.route('/api/review', reviewRouter) // /queue, /counts
app.route('/api/notes', notesRouter) // upload/import + CRUD
app.route('/api/generations', generationsRouter) // AI card generation + review
app.route('/api/exams', examsRouter) // exam deadlines CRUD
app.route('/api/study-plan', studyPlanRouter) // projected load + "today" suggestions
app.route('/api/analytics', analyticsRouter) // heatmap, streaks, study-time, volume, retention, deck-success
app.route('/api/backup', backupRouter) // full-database JSON export + restore
app.route('/api/ai', aiRouter) // multi-provider AI config (settings, keys, test, models)
app.route('/api/me', meRouter) // authenticated identity probe (guard + nav + suspended screen)
app.route('/api/admin', adminRouter) // IAM console: users, role/status/demo, delete, stats, audit
app.route('/api/admin/groups', groupsRouter) // delegated-admin groups: CRUD, permissions, members

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(err.toResponse(), err.status as 400 | 401 | 403 | 404 | 409 | 413 | 502 | 503)
  }
  // Hono-level failures (e.g. malformed JSON body → HTTPException 400) mapped
  // to the single error envelope so they never surface as an opaque 500.
  if (err instanceof HTTPException) {
    const code: ApiErrorCode =
      err.status === 404 ? 'not_found' : err.status === 409 ? 'conflict' : 'validation_error'
    return c.json({ error: { code, message: err.message } }, err.status)
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
