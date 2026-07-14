import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { GenerationItem } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { card, generation, note } from '../db/schema'
import { ConflictError, NotFoundError, ValidationError } from '../http/errors'
import { seedDeck, seedSubject } from '../test-support/harness'
import type { CardGenerator } from '../ai/generator'
import type { ResolvedProviderConfig } from '../ai/providers/types'
import {
  requireGenerationRow,
  resolveGeneration,
  runGenerationJob,
  startGeneration,
} from './generations.service'

/** Resolved provider passed by the router in prod; fixed here for the specs. */
const testCfg: ResolvedProviderConfig = {
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  keySource: 'env',
}

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

/** A fake generator: one card per call, fixed token counts. Never hits the API. */
const oneCardGen: CardGenerator = {
  async generate() {
    return { cards: [{ front: 'Q', back: 'A' }], promptTokens: 10, completionTokens: 5 }
  },
}

async function seedNote(content: string): Promise<string> {
  const [row] = await db
    .insert(note)
    .values({ userId: U, title: 'Note', sourceType: 'md', content })
    .returning()
  return row!.id
}

async function seedGeneration(o: {
  noteId: string
  deckId?: string | null
  status?: 'pending' | 'succeeded' | 'failed'
  items?: GenerationItem[]
  kind?: 'cards' | 'quiz' | 'mixed'
}): Promise<string> {
  const [row] = await db
    .insert(generation)
    .values({
      userId: U,
      noteId: o.noteId,
      kind: o.kind ?? 'cards',
      model: 'claude-sonnet-4-6',
      status: o.status ?? 'pending',
      items: o.items ?? [],
      ...(o.deckId != null ? { deckId: o.deckId } : {}),
    })
    .returning()
  return row!.id
}

describe('startGeneration', () => {
  it('creates a pending row with items [] and returns the DTO', async () => {
    const noteId = await seedNote('some content')
    const dto = await startGeneration(db, U, { noteId, kind: 'cards' }, testCfg, oneCardGen)
    expect(dto.status).toBe('pending')
    expect(dto.items).toEqual([])
    expect(dto.model).toBe('claude-sonnet-4-6')
    expect(dto.provider).toBe('anthropic')
    expect(dto.noteId).toBe(noteId)
  })

  it('unknown noteId → NotFoundError', async () => {
    await expect(
      startGeneration(db, U, { noteId: 'nope', kind: 'cards' }, testCfg, oneCardGen),
    ).rejects.toThrow(NotFoundError)
  })

  it('deckId under an archived subject → ConflictError', async () => {
    const noteId = await seedNote('content')
    const deck = await seedDeck(db, (await seedSubject(db, { archived: true })).id)
    await expect(
      startGeneration(db, U, { noteId, kind: 'cards', deckId: deck.id }, testCfg, oneCardGen),
    ).rejects.toThrow(ConflictError)
  })
})

describe('runGenerationJob', () => {
  it('multi-chunk note → aggregated items, summed tokens, status succeeded', async () => {
    const noteId = await seedNote(`${'A'.repeat(8000)}\n\n${'B'.repeat(8000)}`)
    const genId = await seedGeneration({ noteId })
    await runGenerationJob(db, U, genId, oneCardGen)
    const row = await requireGenerationRow(db, U, genId)
    expect(row.status).toBe('succeeded')
    expect(row.items).toHaveLength(2) // one card per chunk, two chunks
    expect(row.promptTokens).toBe(20)
    expect(row.completionTokens).toBe(10)
    expect(row.items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('generator that throws → status failed + error set, does not throw', async () => {
    const noteId = await seedNote('content')
    const genId = await seedGeneration({ noteId })
    const boomGen: CardGenerator = {
      async generate() {
        throw new Error('boom')
      },
    }
    await runGenerationJob(db, U, genId, boomGen)
    const row = await requireGenerationRow(db, U, genId)
    expect(row.status).toBe('failed')
    expect(row.error).toContain('boom')
  })

  it('generator that rejects on timeout → status failed', async () => {
    const noteId = await seedNote('content')
    const genId = await seedGeneration({ noteId })
    const timeoutGen: CardGenerator = {
      async generate() {
        return Promise.reject(new Error('The operation was aborted due to timeout'))
      },
    }
    await runGenerationJob(db, U, genId, timeoutGen)
    expect((await requireGenerationRow(db, U, genId)).status).toBe('failed')
  })

  it('idempotent — a second run on a succeeded generation is a no-op', async () => {
    const noteId = await seedNote('content')
    const genId = await seedGeneration({ noteId })
    await runGenerationJob(db, U, genId, oneCardGen)
    const first = (await requireGenerationRow(db, U, genId)).items
    // A generator that would add many cards — must not run.
    const manyGen: CardGenerator = {
      async generate() {
        return {
          cards: Array.from({ length: 5 }, (_, i) => ({ front: `x${i}`, back: `y${i}` })),
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    }
    await runGenerationJob(db, U, genId, manyGen)
    expect((await requireGenerationRow(db, U, genId)).items).toEqual(first)
  })

  it("kind 'mixed' → cloze drafts expand to N materialised cards, round-trips through jsonb", async () => {
    const noteId = await seedNote('petite note de cours')
    const genId = await seedGeneration({ noteId, kind: 'mixed' })
    const mixedGen: CardGenerator = {
      async generate() {
        return {
          cards: [
            { kind: 'qa', contentType: 'concept', front: 'Q1', back: 'A1' },
            { kind: 'qa', contentType: 'concept', front: 'Q2', back: 'A2' },
            {
              kind: 'cloze',
              contentType: 'definition',
              clozeText: 'Un {{c1::monoïde}} a un élément {{c2::neutre}}.',
            },
          ],
          promptTokens: 3,
          completionTokens: 2,
        }
      },
    }
    await runGenerationJob(db, U, genId, mixedGen)
    const row = await requireGenerationRow(db, U, genId)
    expect(row.status).toBe('succeeded')
    // 2 qa + a 2-mask cloze materialised into 2 cards = 4 items.
    expect(row.items).toHaveLength(4)

    const qa = row.items.filter((i) => i.kind === 'qa')
    const cloze = row.items.filter((i) => i.kind === 'cloze')
    expect(qa).toHaveLength(2)
    expect(cloze).toHaveLength(2)

    // The evaluation metadata survived the DB jsonb round-trip.
    expect(qa[0]?.contentType).toBe('concept')
    expect(cloze[0]?.contentType).toBe('definition')
    expect(cloze[0]?.clozeText).toBe('Un {{c1::monoïde}} a un élément {{c2::neutre}}.')
    // The materialised faces: recto blanked, verso bold answer, other mask kept.
    expect(cloze[0]?.front).toBe('Un **[…]** a un élément neutre.')
    expect(cloze[0]?.back).toBe('Un **monoïde** a un élément neutre.')
    expect(cloze[1]?.front).toBe('Un monoïde a un élément **[…]**.')
    expect(cloze[1]?.back).toBe('Un monoïde a un élément **neutre**.')
  })

  it("kind 'mixed' → a malformed cloze draft is dropped, valid items kept", async () => {
    const noteId = await seedNote('petite note')
    const genId = await seedGeneration({ noteId, kind: 'mixed' })
    const badGen: CardGenerator = {
      async generate() {
        return {
          cards: [
            { kind: 'qa', front: 'Q', back: 'A' },
            { kind: 'cloze', clozeText: 'aucun trou ici' },
          ],
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    }
    await runGenerationJob(db, U, genId, badGen)
    const row = await requireGenerationRow(db, U, genId)
    expect(row.status).toBe('succeeded')
    expect(row.items).toHaveLength(1) // only the qa item survives
    expect(row.items[0]?.kind).toBe('qa')
  })

  it('respects MAX_TOTAL_ITEMS (global cap)', async () => {
    const noteId = await seedNote(`${'A'.repeat(8000)}\n\n${'B'.repeat(8000)}`)
    const genId = await seedGeneration({ noteId })
    const bulkGen: CardGenerator = {
      async generate() {
        return {
          cards: Array.from({ length: 60 }, (_, i) => ({ front: `q${i}`, back: `a${i}` })),
          promptTokens: 1,
          completionTokens: 1,
        }
      },
    }
    await runGenerationJob(db, U, genId, bulkGen)
    // Two chunks × 60 = 120 proposed, capped at 100.
    expect((await requireGenerationRow(db, U, genId)).items).toHaveLength(100)
  })
})

describe('resolveGeneration', () => {
  async function seedSucceeded(withDeck = true) {
    const noteId = await seedNote('content')
    const deckId = withDeck ? (await seedDeck(db, (await seedSubject(db)).id)).id : null
    const items: GenerationItem[] = [
      { id: 'i0', front: 'Q0', back: 'A0', status: 'pending' },
      { id: 'i1', front: 'Q1', back: 'A1', status: 'pending' },
      { id: 'i2', front: 'Q2', back: 'A2', status: 'pending' },
      { id: 'i3', front: 'Q3', back: 'A3', status: 'pending' },
    ]
    const genId = await seedGeneration({ noteId, deckId, status: 'succeeded', items })
    return { genId, deckId }
  }

  it('accepted/edited insert fresh cards; rejected/pending insert nothing', async () => {
    const { genId, deckId } = await seedSucceeded()
    const dto = await resolveGeneration(db, U, genId, {
      items: [
        { id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' },
        { id: 'i1', front: 'edited front', back: 'edited back', status: 'edited' },
        { id: 'i2', front: 'Q2', back: 'A2', status: 'rejected' },
        { id: 'i3', front: 'Q3', back: 'A3', status: 'pending' },
      ],
    })
    const cards = await db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
    expect(cards).toHaveLength(2)
    const byId = new Map(dto.items.map((i) => [i.id, i]))
    expect(byId.get('i0')?.cardId).toBeDefined()
    expect(byId.get('i1')?.cardId).toBeDefined()
    expect(byId.get('i2')?.cardId).toBeUndefined()
    expect(byId.get('i2')?.status).toBe('rejected')
    expect(byId.get('i3')?.status).toBe('pending')
  })

  it('edited uses the client-modified front/back', async () => {
    const { genId, deckId } = await seedSucceeded()
    await resolveGeneration(db, U, genId, {
      items: [{ id: 'i1', front: 'NEW FRONT', back: 'NEW BACK', status: 'edited' }],
    })
    const cards = await db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.front).toBe('NEW FRONT')
    expect(cards[0]?.back).toBe('NEW BACK')
  })

  it('idempotent — replaying does not recreate cards', async () => {
    const { genId, deckId } = await seedSucceeded()
    const decision = { items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' as const }] }
    await resolveGeneration(db, U, genId, decision)
    await resolveGeneration(db, U, genId, decision)
    const cards = await db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
    expect(cards).toHaveLength(1)
  })

  it('an already-inserted item (cardId) stays frozen even if re-sent as rejected', async () => {
    const { genId, deckId } = await seedSucceeded()
    await resolveGeneration(db, U, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
    })
    const dto = await resolveGeneration(db, U, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'rejected' }],
    })
    const item = dto.items.find((i) => i.id === 'i0')
    expect(item?.status).toBe('accepted')
    expect(item?.cardId).toBeDefined()
    // The card still exists — never dropped.
    expect(
      await db
        .select()
        .from(card)
        .where(eq(card.deckId, deckId as string)),
    ).toHaveLength(1)
  })

  it('status !== succeeded → ConflictError (409)', async () => {
    const noteId = await seedNote('content')
    const genId = await seedGeneration({ noteId, status: 'pending' })
    await expect(resolveGeneration(db, U, genId, { items: [] })).rejects.toThrow(ConflictError)
  })

  it('unknown item id → ValidationError (400)', async () => {
    const { genId } = await seedSucceeded()
    await expect(
      resolveGeneration(db, U, genId, {
        items: [{ id: 'nope', front: 'x', back: 'y', status: 'accepted' }],
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('accepting with no target deck (deckId null) → ConflictError (409)', async () => {
    const { genId } = await seedSucceeded(false)
    await expect(
      resolveGeneration(db, U, genId, {
        items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
      }),
    ).rejects.toThrow(ConflictError)
  })

  it('inserted cards carry a fresh FSRS state (state 0, reps 0)', async () => {
    const { genId, deckId } = await seedSucceeded()
    await resolveGeneration(db, U, genId, {
      items: [{ id: 'i0', front: 'Q0', back: 'A0', status: 'accepted' }],
    })
    const [row] = await db
      .select()
      .from(card)
      .where(eq(card.deckId, deckId as string))
    expect(row?.state).toBe(0)
    expect(row?.reps).toBe(0)
  })
})
