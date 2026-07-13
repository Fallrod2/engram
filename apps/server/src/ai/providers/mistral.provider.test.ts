import { describe, expect, it } from 'vitest'
import { createMistralAdapter } from './mistral.provider'
import { runProviderGeneration } from '../generator'
import type { FetchFn, ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'mistral',
  model: 'mistral-small-latest',
  keySource: 'app',
  secret: 'mist-secret-123',
}
const args = { system: 'sys', userText: 'user', signal: AbortSignal.timeout(1000), attempt: 1 }

const visionArgs = {
  system: 'ocr-sys',
  instruction: 'transcris',
  image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mediaType: 'image/jpeg' as const,
  signal: AbortSignal.timeout(1000),
}

interface Call {
  url: string
  init?: RequestInit
}

/** A fetch stub that records calls and routes the response by URL substring. */
function stubFetch(routes: (url: string, init?: RequestInit) => Response): {
  fetchFn: FetchFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, ...(init ? { init } : {}) })
    return routes(u, init)
  }) as unknown as FetchFn
  return { fetchFn, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('mistralAdapter.complete — function calling (default)', () => {
  it('hits /v1/chat/completions with Bearer auth and parses tool_calls', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'emit_cards',
                    arguments: JSON.stringify({ cards: [{ front: 'Q', back: 'A' }] }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 9, completion_tokens: 5 },
      }),
    )
    const adapter = createMistralAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(9)
    expect(res.completionTokens).toBe(5)

    const call = calls[0]!
    // Default base already carries /v1 — no double /v1/v1.
    expect(call.url).toBe('https://api.mistral.ai/v1/chat/completions')
    const headers = call.init!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer mist-secret-123')
    const body = JSON.parse(call.init!.body as string)
    expect(body.tools[0].function.name).toBe('emit_cards')
  })
})

describe('mistralAdapter.complete — json_schema fallback (attempt 2)', () => {
  it('parses message.content JSON when the strategy is response_format', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        choices: [{ message: { content: '{"cards":[{"front":"Q2","back":"A2"}]}' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    )
    const adapter = createMistralAdapter(fetchFn)
    const res = await adapter.complete(cfg, { ...args, attempt: 2 })
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q2', back: 'A2' }] })
    const body = JSON.parse(calls[0]!.init!.body as string)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.tools).toBeUndefined()
  })

  it('double-fail (free prose on both attempts) → actionable "structured output" error', async () => {
    const { fetchFn } = stubFetch(() =>
      json({ choices: [{ message: { content: 'Voici les cartes, sans JSON.' } }] }),
    )
    const adapter = createMistralAdapter(fetchFn)
    await expect(
      runProviderGeneration(adapter, cfg, { content: 'notes', kind: 'cards' }),
    ).rejects.toThrow(/sortie structurée/i)
  })
})

describe('mistralAdapter.complete — errors', () => {
  it('throws a typed 401 error that never leaks the key', async () => {
    const { fetchFn } = stubFetch(() => json({}, 401))
    const adapter = createMistralAdapter(fetchFn)
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/401/)
    await adapter.complete(cfg, args).catch((e: Error) => {
      expect(e.message).not.toContain('mist-secret-123')
    })
  })
})

describe('mistralAdapter.completeVision — OCR routing (/v1/ocr)', () => {
  it('an *-ocr-* model hits /v1/ocr with a base64 data URI; joins pages[].markdown', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        pages: [
          { index: 0, markdown: '# Page 1' },
          { index: 1, markdown: 'suite' },
        ],
        usage_info: { pages_processed: 2, doc_size_bytes: 4 },
      }),
    )
    const adapter = createMistralAdapter(fetchFn)
    const ocrCfg: ResolvedProviderConfig = { ...cfg, model: 'mistral-ocr-latest' }
    const res = await adapter.completeVision!(ocrCfg, visionArgs)
    expect(res.markdown).toBe('# Page 1\n\nsuite')
    // No prompt/completion tokens on the OCR API.
    expect(res.promptTokens).toBe(0)
    expect(res.completionTokens).toBe(0)

    const call = calls[0]!
    expect(call.url).toBe('https://api.mistral.ai/v1/ocr')
    const body = JSON.parse(call.init!.body as string)
    expect(body.model).toBe('mistral-ocr-latest')
    expect(body.document.type).toBe('image_url')
    expect(body.document.image_url).toMatch(/^data:image\/jpeg;base64,/)
    // The OCR endpoint has no chat prompt field.
    expect(body.messages).toBeUndefined()
  })
})

describe('mistralAdapter.completeVision — chat-vision routing (non-ocr model)', () => {
  it('a non-ocr multimodal model hits /v1/chat/completions with an image_url message', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        choices: [{ message: { content: '# Transcription' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
    )
    const adapter = createMistralAdapter(fetchFn)
    const visionModel: ResolvedProviderConfig = { ...cfg, model: 'pixtral-large-latest' }
    const res = await adapter.completeVision!(visionModel, visionArgs)
    expect(res.markdown).toBe('# Transcription')
    expect(res.promptTokens).toBe(7)

    const call = calls[0]!
    expect(call.url).toBe('https://api.mistral.ai/v1/chat/completions')
    const body = JSON.parse(call.init!.body as string)
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMsg.content.some((p: { type: string }) => p.type === 'image_url')).toBe(true)
  })
})

describe('mistralAdapter.testConnection + listModels', () => {
  it('testConnection ok via GET /v1/models, returning models', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({ data: [{ id: 'mistral-ocr-latest' }, { id: 'mistral-small-latest' }] }),
    )
    const adapter = createMistralAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(true)
    expect(res.detailCode).toBe('ok')
    expect(res.models).toEqual([{ id: 'mistral-ocr-latest' }, { id: 'mistral-small-latest' }])
    expect(calls[0]!.url).toBe('https://api.mistral.ai/v1/models')
  })

  it('testConnection ok=false invalid_key on 401 (no leak)', async () => {
    const { fetchFn } = stubFetch(() => json({}, 401))
    const adapter = createMistralAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(false)
    expect(res.detailCode).toBe('invalid_key')
    expect(res.httpStatus).toBe(401)
    expect(JSON.stringify(res)).not.toContain('mist-secret-123')
  })

  it('testConnection unreachable on a network error', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as FetchFn
    const adapter = createMistralAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(false)
    expect(res.detailCode).toBe('unreachable')
  })

  it('listModels maps ids from /v1/models', async () => {
    const { fetchFn } = stubFetch(() => json({ data: [{ id: 'pixtral-large-latest' }] }))
    const adapter = createMistralAdapter(fetchFn)
    expect(await adapter.listModels!(cfg)).toEqual([{ id: 'pixtral-large-latest' }])
  })
})
