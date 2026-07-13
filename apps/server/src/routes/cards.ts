import { Hono } from 'hono'
import {
  cardSchema,
  createCardSchema,
  idParamSchema,
  listCardsQuerySchema,
  listCardsResponseSchema,
  previewQuerySchema,
  reviewCardSchema,
  reviewPreviewSchema,
  reviewResultSchema,
  updateCardSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { requireUserId } from '../http/identity'
import {
  createCard,
  deleteCard,
  getCard,
  listCards,
  previewCard,
  updateCard,
} from '../services/cards.service'
import { reviewCard, type ReviewInput } from '../services/review.service'

export const cardsRouter = new Hono()

cardsRouter.get('/', zValidator('query', listCardsQuerySchema), async (c) => {
  const q = c.req.valid('query')
  return ok(
    c,
    listCardsResponseSchema,
    await listCards(db, requireUserId(c), {
      limit: q.limit ?? 100,
      offset: q.offset ?? 0,
      ...(q.deckId ? { deckId: q.deckId } : {}),
    }),
  )
})

cardsRouter.post('/', zValidator('json', createCardSchema), async (c) => {
  return ok(c, cardSchema, await createCard(db, requireUserId(c), c.req.valid('json')), 201)
})

cardsRouter.get('/:id', zValidator('param', idParamSchema), async (c) => {
  return ok(c, cardSchema, await getCard(db, requireUserId(c), c.req.valid('param').id))
})

cardsRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateCardSchema),
  async (c) => {
    return ok(
      c,
      cardSchema,
      await updateCard(db, requireUserId(c), c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

cardsRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteCard(db, requireUserId(c), c.req.valid('param').id)
  return c.body(null, 204)
})

cardsRouter.get(
  '/:id/preview',
  zValidator('param', idParamSchema),
  zValidator('query', previewQuerySchema),
  async (c) => {
    const { now } = c.req.valid('query')
    return ok(
      c,
      reviewPreviewSchema,
      await previewCard(
        db,
        requireUserId(c),
        c.req.valid('param').id,
        now ? new Date(now) : new Date(),
      ),
    )
  },
)

cardsRouter.post(
  '/:id/review',
  zValidator('param', idParamSchema),
  zValidator('json', reviewCardSchema),
  async (c) => {
    const body = c.req.valid('json')
    const input: ReviewInput = {
      grade: body.grade,
      ...(body.durationMs !== undefined ? { durationMs: body.durationMs } : {}),
      ...(body.reviewedAt !== undefined ? { reviewedAt: new Date(body.reviewedAt) } : {}),
    }
    return ok(
      c,
      reviewResultSchema,
      await reviewCard(db, requireUserId(c), c.req.valid('param').id, input),
    )
  },
)
