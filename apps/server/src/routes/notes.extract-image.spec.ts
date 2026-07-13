import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { extractImageResponseSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb } from '../test-support/harness'
import { updateAiSettings } from '../services/ai-config.service'
import { resetVisionExtractor, setVisionExtractor, type VisionExtractor } from '../ai/vision'

// Magic-byte prefixes for the multipart bodies.
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a (unsupported)
const HEIC = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]

function imageFile(bytes: number[], name = 'page.jpg'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' })
}

function extract(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return app.request('/api/notes/extract-image', { method: 'POST', body: fd })
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json()) as { error: { code: string; message: string } }
  return body.error
}

/** Make the active provider resolvable (ollama needs only a base URL + model). */
async function configureOllama() {
  await updateAiSettings(db, { activeProvider: 'ollama' })
}

let calls: number
let lastArgs: unknown
/** Spy fake — records the call, so we can assert NO real SDK is reached. */
function spyExtractor(over: Partial<VisionExtractor> = {}): VisionExtractor {
  calls = 0
  lastArgs = undefined
  return {
    supportsVision: () => true,
    extract: async (args) => {
      calls += 1
      lastArgs = args
      return { markdown: '# Titre\n\nune ligne douteuse [?]', promptTokens: 5, completionTokens: 3 }
    },
    ...over,
  }
}

beforeEach(async () => {
  await resetDb(db)
  setVisionExtractor(spyExtractor())
})
afterEach(() => resetVisionExtractor())

describe('POST /api/notes/extract-image', () => {
  it('JPEG → 200 with markdown, mediaType, warnings; calls the injected extractor once', async () => {
    await configureOllama()
    const res = await extract(imageFile(JPEG))
    expect(res.status).toBe(200)
    const body = extractImageResponseSchema.parse(await res.json())
    expect(body.markdown).toContain('Titre')
    expect(body.mediaType).toBe('image/jpeg')
    // The `[?]` marker from the fake yields exactly one warning.
    expect(body.warnings).toHaveLength(1)
    expect(body.warnings[0]).toContain('[?]')
    // Proof the fake path ran (never the real @anthropic-ai/sdk transport).
    expect(calls).toBe(1)
    expect((lastArgs as { mediaType: string }).mediaType).toBe('image/jpeg')
    // No note was written (preview-before-create).
    const notes = await app.request('/api/notes')
    const list = (await notes.json()) as { notes: unknown[] }
    expect(list.notes).toHaveLength(0)
  })

  it('missing file → 400', async () => {
    await configureOllama()
    const res = await app.request('/api/notes/extract-image', {
      method: 'POST',
      body: new FormData(),
    })
    expect(res.status).toBe(400)
  })

  it('image > 4 MB (post-downscale guard-rail) → 413 payload_too_large', async () => {
    await configureOllama()
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })
    const res = await extract(big)
    expect(res.status).toBe(413)
    expect((await errorOf(res)).code).toBe('payload_too_large')
  })

  it('HEIC magic bytes → 400 with an actionable message', async () => {
    await configureOllama()
    const res = await extract(imageFile(HEIC, 'photo.heic'))
    expect(res.status).toBe(400)
    expect((await errorOf(res)).message).toContain('HEIC')
  })

  it('unsupported image type (gif) → 400', async () => {
    await configureOllama()
    const res = await extract(imageFile(GIF, 'anim.gif'))
    expect(res.status).toBe(400)
    expect((await errorOf(res)).message).toContain('non supporté')
  })

  it('no provider configured → 503', async () => {
    // openai-compat with empty model/baseUrl is NOT usable → resolver returns null.
    await updateAiSettings(db, { activeProvider: 'openai-compat' })
    const res = await extract(imageFile(JPEG))
    expect(res.status).toBe(503)
    const err = await errorOf(res)
    expect(err.code).toBe('service_unavailable')
    expect(err.message).toContain('aucun fournisseur')
  })

  it('configured provider WITHOUT vision → 503 (vision message)', async () => {
    await configureOllama()
    setVisionExtractor(spyExtractor({ supportsVision: () => false }))
    const res = await extract(imageFile(JPEG))
    expect(res.status).toBe(503)
    const err = await errorOf(res)
    expect(err.code).toBe('service_unavailable')
    expect(err.message).toContain('vision')
    // The guard runs BEFORE any extraction attempt.
    expect(calls).toBe(0)
  })

  it('empty extraction → 400 "aucun texte extrait"', async () => {
    await configureOllama()
    setVisionExtractor(
      spyExtractor({
        extract: async () => ({ markdown: '   ', promptTokens: 1, completionTokens: 1 }),
      }),
    )
    const res = await extract(imageFile(JPEG))
    expect(res.status).toBe(400)
    expect((await errorOf(res)).message).toContain('aucun texte extrait')
  })
})
