import { Hono } from 'hono'
import {
  generationSchema,
  idParamSchema,
  listGenerationsQuerySchema,
  listGenerationsResponseSchema,
  resolveGenerationSchema,
  startGenerationSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId, requireNotDemoSpend } from '../http/identity'
import { ServiceUnavailableError } from '../http/errors'
import { resolveActiveProvider } from '../services/ai-config.service'
import {
  deleteGeneration,
  getGeneration,
  listGenerations,
  resolveGeneration,
  startGeneration,
} from '../services/generations.service'

export const generationsRouter = new Hono()

/**
 * The demo's refusal on this route (T-058). Names the way out — the demo ships a
 * pre-recorded generation whose card-by-card review is the thing worth seeing —
 * so the visitor reads a deliberate product limit, not a breakage.
 */
const DEMO_NO_GENERATION =
  'La démo ne lance pas de génération IA réelle. Ouvrez la génération d’exemple fournie avec le compte de démonstration pour voir la revue carte par carte.'

// POST /api/generations — launch a fire-and-forget generation job (202).
generationsRouter.post('/', zValidator('json', startGenerationSchema), async (c) => {
  // THE spending route. Refused for the demo BEFORE anything is resolved (T-058):
  // a real generation bills whoever's key resolves, and the demo login is public.
  const userId = requireNotDemoSpend(c, DEMO_NO_GENERATION)
  // Resolve the active provider ONCE (single DB read, no TOCTOU): it is both the
  // 503 guard and the config stamped on the row + passed to the job. Scoped to
  // the caller (spec BYOK §1.3) — a user without their own key gets a clean 503.
  const cfg = await resolveActiveProvider(db, userId)
  if (!cfg) {
    throw new ServiceUnavailableError('AI generation unavailable: no provider configured')
  }
  return ok(c, generationSchema, await startGeneration(db, userId, c.req.valid('json'), cfg), 202)
})

// GET /api/generations — list, optional noteId filter.
generationsRouter.get('/', zValidator('query', listGenerationsQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(c, listGenerationsResponseSchema, await listGenerations(db, requireUserId(c), q.noteId))
})

// GET /api/generations/:id — poll endpoint.
generationsRouter.get('/:id', zValidator('param', idParamSchema), async (c) => {
  return ok(c, generationSchema, await getGeneration(db, requireUserId(c), c.req.valid('param').id))
})

// POST /api/generations/:id/resolve — per-card decisions + card insertion.
generationsRouter.post(
  '/:id/resolve',
  zValidator('param', idParamSchema),
  zValidator('json', resolveGenerationSchema),
  async (c) => {
    return ok(
      c,
      generationSchema,
      await resolveGeneration(db, requireUserId(c), c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

generationsRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteGeneration(db, requireUserId(c), c.req.valid('param').id)
  return c.body(null, 204)
})
