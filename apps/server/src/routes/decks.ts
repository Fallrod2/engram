import { Hono } from 'hono'
import { z } from 'zod'
import {
  createDeckSchema,
  deckSchema,
  idParamSchema,
  listDecksQuerySchema,
  updateDeckSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { createDeck, deleteDeck, getDeck, listDecks, updateDeck } from '../services/decks.service'

export const decksRouter = new Hono()

decksRouter.get('/', zValidator('query', listDecksQuerySchema), (c) => {
  return ok(c, z.array(deckSchema), listDecks(db, c.req.valid('query').subjectId))
})

decksRouter.post('/', zValidator('json', createDeckSchema), (c) => {
  return ok(c, deckSchema, createDeck(db, c.req.valid('json')), 201)
})

decksRouter.get('/:id', zValidator('param', idParamSchema), (c) => {
  return ok(c, deckSchema, getDeck(db, c.req.valid('param').id))
})

decksRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateDeckSchema),
  (c) => {
    return ok(c, deckSchema, updateDeck(db, c.req.valid('param').id, c.req.valid('json')))
  },
)

decksRouter.delete('/:id', zValidator('param', idParamSchema), (c) => {
  deleteDeck(db, c.req.valid('param').id)
  return c.body(null, 204)
})
