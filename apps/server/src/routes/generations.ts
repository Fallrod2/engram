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
import { ServiceUnavailableError } from '../http/errors'
import { hasAnthropicKey } from '../ai/client'
import {
  deleteGeneration,
  getGeneration,
  listGenerations,
  resolveGeneration,
  startGeneration,
} from '../services/generations.service'

export const generationsRouter = new Hono()

// POST /api/generations — launch a fire-and-forget generation job (202).
generationsRouter.post('/', zValidator('json', startGenerationSchema), (c) => {
  // Guard the key before creating any row; the rest of the app stays usable.
  if (!hasAnthropicKey()) {
    throw new ServiceUnavailableError('AI generation unavailable: ANTHROPIC_API_KEY not configured')
  }
  return ok(c, generationSchema, startGeneration(db, c.req.valid('json')), 202)
})

// GET /api/generations — list, optional noteId filter.
generationsRouter.get('/', zValidator('query', listGenerationsQuerySchema), (c) => {
  const q = c.req.valid('query')
  return ok(c, listGenerationsResponseSchema, listGenerations(db, q.noteId))
})

// GET /api/generations/:id — poll endpoint.
generationsRouter.get('/:id', zValidator('param', idParamSchema), (c) => {
  return ok(c, generationSchema, getGeneration(db, c.req.valid('param').id))
})

// POST /api/generations/:id/resolve — per-card decisions + card insertion.
generationsRouter.post(
  '/:id/resolve',
  zValidator('param', idParamSchema),
  zValidator('json', resolveGenerationSchema),
  (c) => {
    return ok(
      c,
      generationSchema,
      resolveGeneration(db, c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

generationsRouter.delete('/:id', zValidator('param', idParamSchema), (c) => {
  deleteGeneration(db, c.req.valid('param').id)
  return c.body(null, 204)
})
