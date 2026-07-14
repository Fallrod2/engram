import { describe, expect, it } from 'vitest'
import { createOpenAiCodexAdapter } from './openai-codex.provider'
import type { FetchFn, ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'openai-codex',
  model: 'gpt-5.5',
  keySource: 'app',
  oauth: { accessToken: 'access-abc', accountId: 'acct-123' },
}
const args = { system: 'sys', userText: 'user', signal: AbortSignal.timeout(1000), attempt: 1 }

interface Call {
  url: string
  init?: RequestInit
}
function stubFetch(routes: (url: string) => Response): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, ...(init ? { init } : {}) })
    return routes(u)
  }) as unknown as FetchFn
  return { fetchFn, calls }
}

/** Build a minimal SSE body for a Responses stream. */
function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('openAiCodexAdapter.complete', () => {
  it('sends the Codex/Responses form + auth headers and parses streamed JSON', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      sse([
        { type: 'response.output_text.delta', delta: '{"cards":[{"front":"Q",' },
        { type: 'response.output_text.delta', delta: '"back":"A"}]}' },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 11, output_tokens: 4 } },
        },
      ]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(11)
    expect(res.completionTokens).toBe(4)

    const call = calls[0]!
    expect(call.url).toContain('/backend-api/codex/responses')
    const h = call.init!.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer access-abc')
    expect(h['chatgpt-account-id']).toBe('acct-123')
    expect(h.originator).toBe('codex_cli_rs')
    expect(h['OpenAI-Beta']).toBe('responses=experimental')
    const body = JSON.parse(call.init!.body as string)
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(typeof body.instructions).toBe('string')
    expect(body.input[0].content[0].type).toBe('input_text')
    // Regression (Alex's real 400): the subscription backend rejects any
    // parameter outside its allowlist — max_output_tokens must NEVER be sent.
    expect(body).not.toHaveProperty('max_output_tokens')
  })

  it('surfaces the backend {"detail"} body in non-ok errors (names the bad parameter)', async () => {
    const { fetchFn } = stubFetch(
      () =>
        new Response(JSON.stringify({ detail: 'Unsupported parameter: max_output_tokens' }), {
          status: 400,
        }),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await expect(adapter.complete(cfg, args)).rejects.toThrow(
      /HTTP 400.*Unsupported parameter: max_output_tokens/,
    )
  })

  it('prefers the completed event full text over streamed deltas (no double count)', async () => {
    const { fetchFn } = stubFetch(() =>
      sse([
        { type: 'response.output_text.delta', delta: 'garbage-partial' },
        {
          type: 'response.completed',
          response: {
            output_text: '{"cards":[{"front":"Full","back":"Text"}]}',
            usage: { input_tokens: 3, output_tokens: 2 },
          },
        },
      ]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Full', back: 'Text' }] })
  })

  it('reinforces the JSON directive on attempt 2', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      sse([{ type: 'response.completed', response: { output_text: '{"cards":[]}' } }]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await adapter.complete(cfg, { ...args, attempt: 2 })
    const body = JSON.parse(calls[0]!.init!.body as string)
    expect(body.instructions).toMatch(/EXCLUSIVEMENT|exploitable/i)
  })

  it('throws unstructured-output error when the stream carries no JSON', async () => {
    const { fetchFn } = stubFetch(() =>
      sse([{ type: 'response.output_text.delta', delta: 'sorry, I cannot' }]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/structurée|structured/i)
  })

  it('maps a 401 to an error (token no longer valid)', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 401 }))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/401/)
  })

  it('never interpolates the access token into the error', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 500 }))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const err = await adapter.complete(cfg, args).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('access-abc')
  })
})

describe('openAiCodexAdapter.testConnection + listModels', () => {
  it('ok when the probe succeeds', async () => {
    const { fetchFn } = stubFetch(() => sse([{ type: 'response.completed', response: {} }]))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res).toEqual({ ok: true, detailCode: 'ok' })
  })

  it('401 → invalid_key; 403 → forbidden', async () => {
    const adapter401 = createOpenAiCodexAdapter(
      stubFetch(() => new Response('', { status: 401 })).fetchFn,
    )
    expect(await adapter401.testConnection(cfg)).toMatchObject({
      ok: false,
      detailCode: 'invalid_key',
    })
    const adapter403 = createOpenAiCodexAdapter(
      stubFetch(() => new Response('', { status: 403 })).fetchFn,
    )
    expect(await adapter403.testConnection(cfg)).toMatchObject({
      ok: false,
      detailCode: 'forbidden',
    })
  })

  it('no oauth token → no_credentials (never calls the backend)', async () => {
    const { fetchFn, calls } = stubFetch(() => sse([]))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const noOauth: ResolvedProviderConfig = {
      providerId: 'openai-codex',
      model: 'gpt-5.5',
      keySource: 'app',
    }
    const res = await adapter.testConnection(noOauth)
    expect(res).toEqual({ ok: false, detailCode: 'no_credentials' })
    expect(calls).toHaveLength(0)
  })

  it('listModels returns the static presets', async () => {
    const { fetchFn } = stubFetch(() => sse([]))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const models = await adapter.listModels!(cfg)
    expect(models.map((m) => m.id)).toContain('gpt-5.5')
  })

  it('supportsVision is true for the multimodal subscription presets', () => {
    const adapter = createOpenAiCodexAdapter(stubFetch(() => sse([])).fetchFn)
    expect(adapter.supportsVision?.(cfg)).toBe(true)
  })
})

describe('openAiCodexAdapter.completeVision', () => {
  const visionArgs = {
    system: 'OCR faithfully',
    instruction: 'Transcribe this page',
    image: new Uint8Array([137, 80, 78, 71]),
    mediaType: 'image/png' as const,
    signal: AbortSignal.timeout(1000),
  }

  it('sends an input_image data-URL block and NO forbidden parameter', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      sse([
        {
          type: 'response.completed',
          response: {
            output_text: '# Transcription\n\ncontenu',
            usage: { input_tokens: 20, output_tokens: 9 },
          },
        },
      ]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const res = await adapter.completeVision!(cfg, visionArgs)
    expect(res.markdown).toContain('Transcription')
    expect(res.promptTokens).toBe(20)
    expect(res.completionTokens).toBe(9)

    const body = JSON.parse(calls[0]!.init!.body as string)
    // input_text + input_image in the SAME content array.
    const content = body.input[0].content as { type: string; image_url?: string }[]
    expect(content[0]!.type).toBe('input_text')
    expect(content[1]!.type).toBe('input_image')
    // Bare data-URI STRING (not the Chat Completions {url} object), png MIME.
    expect(content[1]!.image_url).toBe('data:image/png;base64,iVBORw==')
    expect(typeof content[1]!.image_url).toBe('string')
    // Strict allowlist: no vision-only or generation-only extra fields.
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('detail')
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    // OCR path drops the JSON directive (free Markdown, not a {cards} object).
    expect(body.instructions).not.toMatch(/JSON/i)
    expect(body.instructions).toBe('OCR faithfully')
  })

  it('builds a jpeg data-URL for image/jpeg', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      sse([{ type: 'response.completed', response: { output_text: 'ok' } }]),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await adapter.completeVision!(cfg, { ...visionArgs, mediaType: 'image/jpeg' })
    const body = JSON.parse(calls[0]!.init!.body as string)
    const content = body.input[0].content as { image_url?: string }[]
    expect(content[1]!.image_url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('rejects an exotic media type with a clear error (no network call)', async () => {
    const { fetchFn, calls } = stubFetch(() => sse([]))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await expect(
      // @ts-expect-error — deliberately passing an out-of-allowlist MIME
      adapter.completeVision!(cfg, { ...visionArgs, mediaType: 'image/gif' }),
    ).rejects.toThrow(/non support|jpeg\/png\/webp/i)
    expect(calls).toHaveLength(0)
  })

  it('surfaces a non-ok backend error with its {detail} body', async () => {
    const { fetchFn } = stubFetch(
      () =>
        new Response(JSON.stringify({ detail: 'Expected a base64-encoded data URL' }), {
          status: 400,
        }),
    )
    const adapter = createOpenAiCodexAdapter(fetchFn)
    await expect(adapter.completeVision!(cfg, visionArgs)).rejects.toThrow(
      /HTTP 400.*base64-encoded data URL/,
    )
  })

  it('never interpolates the access token into a vision error', async () => {
    const { fetchFn } = stubFetch(() => new Response('', { status: 500 }))
    const adapter = createOpenAiCodexAdapter(fetchFn)
    const err = await adapter.completeVision!(cfg, visionArgs).catch((e: unknown) => e)
    expect((err as Error).message).not.toContain('access-abc')
  })
})
