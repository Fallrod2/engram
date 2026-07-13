import { describe, expect, it } from 'vitest'
import { createOllamaAdapter } from './ollama.provider'
import type { FetchFn, ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'ollama',
  model: 'llama3.1',
  keySource: null,
  baseUrl: 'http://localhost:11434',
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('ollamaAdapter.complete — structured format (default)', () => {
  it('parses message.content JSON, maps eval counts, sends NO Authorization header', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        message: { content: '{"cards":[{"front":"Q","back":"A"}]}' },
        prompt_eval_count: 9,
        eval_count: 3,
      }),
    )
    const adapter = createOllamaAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(9)
    expect(res.completionTokens).toBe(3)

    const call = calls[0]!
    expect(call.url).toBe('http://localhost:11434/api/chat')
    const headers = (call.init!.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    const body = JSON.parse(call.init!.body as string)
    expect(body.format).toBeDefined() // structured output
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBe(false)
  })
})

describe('ollamaAdapter.complete — native tools fallback (attempt 2)', () => {
  it('parses message.tool_calls[0].function.arguments (object)', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        message: {
          tool_calls: [
            {
              function: { name: 'emit_cards', arguments: { cards: [{ front: 'Q2', back: 'A2' }] } },
            },
          ],
        },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    )
    const adapter = createOllamaAdapter(fetchFn)
    const res = await adapter.complete(cfg, { ...args, attempt: 2 })
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q2', back: 'A2' }] })
    const body = JSON.parse(calls[0]!.init!.body as string)
    expect(body.tools[0].function.name).toBe('emit_cards')
  })
})

describe('ollamaAdapter.testConnection + listModels', () => {
  it('lists installed models via /api/tags, no auth header, default base URL', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        models: [{ name: 'llama3.1', details: { parameter_size: '8B' } }, { name: 'qwen2.5' }],
      }),
    )
    const adapter = createOllamaAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(true)
    expect(res.models).toEqual([{ id: 'llama3.1', label: 'llama3.1 · 8B' }, { id: 'qwen2.5' }])
    expect(calls[0]!.url).toBe('http://localhost:11434/api/tags')
  })

  it('testConnection ok=false when Ollama is unreachable', async () => {
    const fetchFn = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as FetchFn
    const adapter = createOllamaAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(false)
  })
})
