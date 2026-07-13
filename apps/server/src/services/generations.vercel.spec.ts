import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { note } from '../db/schema'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import type { CardGenerator } from '../ai/generator'
import type { ResolvedProviderConfig } from '../ai/providers/types'
import { startGeneration } from './generations.service'

/** Resolved provider passed by the router in prod; fixed here for the specs. */
const testCfg: ResolvedProviderConfig = {
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  keySource: 'env',
}

/**
 * Covers the Vercel-only wiring in `startGeneration`:
 *   `if (process.env.VERCEL === '1') waitUntil(job)`
 *
 * Rather than mocking the `@vercel/functions` module, we drive the *real*
 * `waitUntil` by installing a fake Vercel request context on `globalThis`
 * (the same `Symbol.for('@vercel/request-context')` the SDK reads). This proves
 * that (a) with `VERCEL=1` the fire-and-forget job is registered with the
 * platform via `waitUntil`, and (b) without `VERCEL=1` it is never registered —
 * i.e. the câblage n'affecte QUE l'env Vercel and the local/test path is
 * unchanged. No real Anthropic call happens: the fake generator is injected.
 */

const REQ_CONTEXT = Symbol.for('@vercel/request-context')

/** A fake generator: one card per call, fixed token counts. Never hits the API. */
const oneCardGen: CardGenerator = {
  async generate() {
    return { cards: [{ front: 'Q', back: 'A' }], promptTokens: 10, completionTokens: 5 }
  },
}

let t: TestDb
let db: DB
let registered: Promise<unknown>[]

beforeEach(async () => {
  t = await createTestDb()
  db = t.db
  registered = []
  // Simulate a Vercel invocation context so the real `waitUntil` has somewhere
  // to hand the promise. `waitUntil` reads `globalThis[symbol].get().waitUntil`.
  ;(globalThis as unknown as Record<symbol, unknown>)[REQ_CONTEXT] = {
    get: () => ({ waitUntil: (p: Promise<unknown>) => registered.push(p) }),
  }
})

afterEach(async () => {
  delete process.env.VERCEL
  delete (globalThis as unknown as Record<symbol, unknown>)[REQ_CONTEXT]
  await t.cleanup()
})

async function seedNote(content: string): Promise<string> {
  const [row] = await db
    .insert(note)
    .values({ title: 'Note', sourceType: 'md', content })
    .returning()
  return row!.id
}

describe('startGeneration — Vercel waitUntil wiring', () => {
  it('with VERCEL=1, registers the fire-and-forget job via waitUntil', async () => {
    process.env.VERCEL = '1'
    const noteId = await seedNote('some content')

    const dto = await startGeneration(db, { noteId, kind: 'cards' }, testCfg, oneCardGen)

    expect(dto.status).toBe('pending')
    expect(registered).toHaveLength(1)
    // It is a Promise (the job), and awaiting it settles cleanly (job is caught).
    expect(typeof (registered[0] as { then?: unknown }).then).toBe('function')
    await registered[0]
  })

  it('without VERCEL, never calls waitUntil (job stays a plain local promise)', async () => {
    // VERCEL unset by default (afterEach deletes it); assert it explicitly.
    expect(process.env.VERCEL).toBeUndefined()
    const noteId = await seedNote('some content')

    const dto = await startGeneration(db, { noteId, kind: 'cards' }, testCfg, oneCardGen)

    expect(dto.status).toBe('pending')
    expect(registered).toHaveLength(0)
  })

  it('VERCEL set to a value other than "1" does not trigger waitUntil', async () => {
    process.env.VERCEL = 'true'
    const noteId = await seedNote('some content')

    await startGeneration(db, { noteId, kind: 'cards' }, testCfg, oneCardGen)

    expect(registered).toHaveLength(0)
  })
})
