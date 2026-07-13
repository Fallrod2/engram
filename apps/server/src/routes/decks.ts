import { Hono } from 'hono'
import { z } from 'zod'
import {
  createDeckSchema,
  deckCardCountsSchema,
  deckSchema,
  idParamSchema,
  listDecksQuerySchema,
  updateDeckSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import {
  cardCountsByDeck,
  createDeck,
  deleteDeck,
  getDeck,
  listDecks,
  updateDeck,
} from '../services/decks.service'

export const decksRouter = new Hono()

decksRouter.get('/', zValidator('query', listDecksQuerySchema), async (c) => {
  return ok(
    c,
    z.array(deckSchema),
    await listDecks(db, requireUserId(c), c.req.valid('query').subjectId),
  )
})

// MUST precede `/:id` — otherwise `card-counts` is captured as an `:id` param.
decksRouter.get('/card-counts', async (c) => {
  return ok(c, deckCardCountsSchema, await cardCountsByDeck(db, requireUserId(c)))
})

decksRouter.post('/', zValidator('json', createDeckSchema), async (c) => {
  return ok(c, deckSchema, await createDeck(db, requireUserId(c), c.req.valid('json')), 201)
})

decksRouter.get('/:id', zValidator('param', idParamSchema), async (c) => {
  return ok(c, deckSchema, await getDeck(db, requireUserId(c), c.req.valid('param').id))
})

decksRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateDeckSchema),
  async (c) => {
    return ok(
      c,
      deckSchema,
      await updateDeck(db, requireUserId(c), c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

decksRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteDeck(db, requireUserId(c), c.req.valid('param').id)
  return c.body(null, 204)
})
