import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { app } from '../app'
import { db } from '../db/client'
import { generation } from '../db/schema'
import { resetDb, seedUserProfile } from '../test-support/harness'
import { setCardGenerator, resetCardGenerator, type CardGenerator } from '../ai/generator'
import { setVisionExtractor, resetVisionExtractor, type VisionExtractor } from '../ai/vision'
import { updateAiSettings } from '../services/ai-config.service'
import { DEFAULT_DEV_USER_ID } from '../auth/config'

/**
 * T-058 — the demo account NEVER spends. Two routes bill a real AI call:
 * `POST /api/generations` and `POST /api/notes/extract-image`. Neither had a demo
 * rule; the demo resolved generation/OCR through the admin read alias; and the
 * demo login is PUBLIC (`POST /api/demo/session`). What kept an anonymous visitor
 * from billing Alex was therefore not a rule but the absence of a key on the
 * deployment — a door held shut by circumstance.
 *
 * THE FIRST TEST BELOW IS THE HOLE, REPRODUCED: prod-shaped env (a distinct admin
 * id, a demo id, a resolvable key), demo identity, one call on each spending
 * route. Before the fix it answers 202 and writes a generation row that would run
 * on the admin's key; it is red on `main` and green here. The rest pins that the
 * refusal is narrow — a normal user and the admin still generate.
 *
 * Harness: with no auth env the gate is bypassed and the caller's `sub` is
 * `ENGRAM_DEV_USER_ID`, so pointing that at the demo id makes the default caller
 * the demo account (same trick as `demo-reset.spec.ts`). The demo middleware then
 * seeds the showcase dataset on the first request, which is exactly the state a
 * visitor clicks from — including the pre-recorded generation the refusal points
 * them to.
 */

const DEMO = 'demo-user'
const ADMIN = 'alex-admin'
/** Non-empty, NEVER a real key: it only has to make the resolver say "usable". */
const PLACEHOLDER_KEY = 'test-placeholder-not-a-real-key'

const ENV_VARS = [
  'ENGRAM_DEMO_USER_ID',
  'ENGRAM_DEV_USER_ID',
  'ENGRAM_ADMIN_USER_ID',
  'ANTHROPIC_API_KEY',
] as const
const ORIGINAL = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]))

/** Records every call, so "nothing was spent" is asserted, not assumed. */
let generateCalls = 0
const spyGenerator: CardGenerator = {
  async generate() {
    generateCalls += 1
    return { cards: [{ front: 'Q1', back: 'A1' }], promptTokens: 10, completionTokens: 5 }
  },
}

let visionCalls = 0
const spyExtractor: VisionExtractor = {
  supportsVision: () => true,
  async extract() {
    visionCalls += 1
    return { markdown: '# Transcription', promptTokens: 5, completionTokens: 3 }
  },
}

beforeEach(async () => {
  await resetDb(db)
  for (const k of ENV_VARS) delete process.env[k]
  generateCalls = 0
  visionCalls = 0
  setCardGenerator(spyGenerator)
  setVisionExtractor(spyExtractor)
})
afterEach(() => {
  resetCardGenerator()
  resetVisionExtractor()
})
afterAll(() => {
  for (const k of ENV_VARS) {
    const v = ORIGINAL[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/**
 * The deployment shape that makes the hole reachable: an admin id distinct from
 * the caller, a demo id the caller matches, and a key that resolves for the admin.
 */
function prodShapedDemo(): void {
  process.env.ENGRAM_ADMIN_USER_ID = ADMIN
  process.env.ENGRAM_DEMO_USER_ID = DEMO
  process.env.ENGRAM_DEV_USER_ID = DEMO // the bypass caller IS the demo account
  process.env.ANTHROPIC_API_KEY = PLACEHOLDER_KEY
}

/** Same deployment, but the caller is the admin instead of the demo. */
function prodShapedAdmin(): void {
  process.env.ENGRAM_ADMIN_USER_ID = ADMIN
  process.env.ENGRAM_DEMO_USER_ID = DEMO
  process.env.ENGRAM_DEV_USER_ID = ADMIN
  process.env.ANTHROPIC_API_KEY = PLACEHOLDER_KEY
}

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** JPEG magic bytes — enough for the media detection to accept the upload. */
function jpeg(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'page.jpg', { type: 'image/jpeg' })
}

function extractImage() {
  const fd = new FormData()
  fd.append('file', jpeg())
  return app.request('/api/notes/extract-image', { method: 'POST', body: fd })
}

async function errorOf(
  res: Response,
): Promise<{ code: string; message: string; details?: unknown }> {
  const body = (await res.json()) as {
    error: { code: string; message: string; details?: unknown }
  }
  return body.error
}

/** The demo's own note, from the dataset the middleware seeds on first contact. */
async function firstDemoNoteId(): Promise<string> {
  const res = await app.request('/api/notes')
  const { notes } = (await res.json()) as { notes: { id: string }[] }
  expect(notes.length).toBeGreaterThan(0)
  return notes[0]!.id
}

describe('the demo account can never spend (T-058)', () => {
  it('POST /api/generations by the demo → 403 demo_no_spend, no row, no AI call', async () => {
    prodShapedDemo()
    const noteId = await firstDemoNoteId() // also triggers the demo seed
    const before = await db.select().from(generation)

    const res = await postJson('/api/generations', { noteId, kind: 'cards' })

    expect(res.status).toBe(403)
    const err = await errorOf(res)
    expect(err.code).toBe('forbidden')
    expect(err.details).toEqual({ reason: 'demo_no_spend' })
    // Honest AND actionable: it names the demo, and points at the pre-recorded
    // example rather than leaving the visitor thinking the feature is broken.
    expect(err.message).toMatch(/démo/i)
    expect(err.message).toMatch(/exemple/i)

    // Nothing was written, and nothing was billed: the only generations are the
    // pre-recorded ones the seed ships (T-031).
    const after = await db.select().from(generation)
    expect(after).toHaveLength(before.length)
    expect(after.every((g) => g.origin === 'prerecorded')).toBe(true)
    expect(generateCalls).toBe(0)
  })

  it('POST /api/notes/extract-image by the demo → 403 demo_no_spend, no OCR call', async () => {
    prodShapedDemo()
    await app.request('/api/notes') // seed the demo, as a visiting browser would

    const res = await extractImage()

    expect(res.status).toBe(403)
    const err = await errorOf(res)
    expect(err.code).toBe('forbidden')
    expect(err.details).toEqual({ reason: 'demo_no_spend' })
    expect(err.message).toMatch(/démo/i)
    // The way out of an OCR refusal is the flow that costs nothing.
    expect(err.message).toMatch(/collez|importez/i)
    expect(visionCalls).toBe(0)
  })

  it('refuses a DB-flagged demo too, with no ENGRAM_DEMO_USER_ID set', async () => {
    // `is_demo` set from /admin activates the demo behaviour without a redeploy
    // (amendment A8). The spending rule uses the SAME detection as the AI-config
    // rule, so it must fire on the flag alone.
    process.env.ANTHROPIC_API_KEY = PLACEHOLDER_KEY
    await seedUserProfile(db, { userId: DEFAULT_DEV_USER_ID, isDemo: true })
    await app.request('/api/notes') // the flag also triggers the demo seed
    const noteId = await firstDemoNoteId()

    const res = await postJson('/api/generations', { noteId, kind: 'cards' })
    expect(res.status).toBe(403)
    expect((await errorOf(res)).details).toEqual({ reason: 'demo_no_spend' })
    expect(generateCalls).toBe(0)
  })
})

describe('the refusal is narrow — everybody else still generates', () => {
  it('a normal user with their own provider still gets 202 + OCR 200', async () => {
    // No demo env at all: the bypass caller is a plain user, bringing their own
    // keyless provider (ollama) so nothing depends on the env key.
    await updateAiSettings(db, DEFAULT_DEV_USER_ID, { activeProvider: 'ollama' })
    const created = await postJson('/api/notes', {
      title: 'N',
      sourceType: 'md',
      content: 'du cours',
    })
    const { id: noteId } = (await created.json()) as { id: string }

    const gen = await postJson('/api/generations', { noteId, kind: 'cards' })
    expect(gen.status).toBe(202)

    const ocr = await extractImage()
    expect(ocr.status).toBe(200)
    expect(visionCalls).toBe(1)
  })

  it('the admin still generates on the env key while a demo id is configured', async () => {
    prodShapedAdmin()
    const created = await postJson('/api/notes', {
      title: 'N',
      sourceType: 'md',
      content: 'du cours',
    })
    const { id: noteId } = (await created.json()) as { id: string }

    const res = await postJson('/api/generations', { noteId, kind: 'cards' })
    expect(res.status).toBe(202)

    const rows = await db.select().from(generation)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userId).toBe(ADMIN)
    expect(rows[0]!.origin).toBe('live')
  })
})
