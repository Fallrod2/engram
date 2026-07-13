import { describe, expect, it } from 'vitest'
import { createOpenRouterAdapter } from './openrouter.provider'
import { runProviderGeneration } from '../generator'
import type { FetchFn, ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  keySource: 'app',
  secret: 'or-secret-123',
}
const args = { system: 'sys', userText: 'user', signal: AbortSignal.timeout(1000), attempt: 1 }

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

describe('openRouterAdapter.complete — function calling (default)', () => {
  it('parses tool_calls[0].function.arguments and sends auth + attribution headers', async () => {
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
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      }),
    )
    const adapter = createOpenRouterAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(11)
    expect(res.completionTokens).toBe(4)

    const call = calls[0]!
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = call.init!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer or-secret-123')
    expect(headers['HTTP-Referer']).toBe('http://localhost:5173')
    expect(headers['X-Title']).toBe('engram')
    // Attempt 1 uses tools, not response_format.
    const body = JSON.parse(call.init!.body as string)
    expect(body.tools[0].function.name).toBe('emit_cards')
  })
})

describe('openRouterAdapter.complete — json_schema fallback (attempt 2)', () => {
  it('parses message.content JSON when the strategy is response_format', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        choices: [{ message: { content: '```json\n{"cards":[{"front":"Q2","back":"A2"}]}\n```' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    )
    const adapter = createOpenRouterAdapter(fetchFn)
    const res = await adapter.complete(cfg, { ...args, attempt: 2 })
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q2', back: 'A2' }] })
    const body = JSON.parse(calls[0]!.init!.body as string)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.tools).toBeUndefined()
  })
})

describe('openRouterAdapter.complete — errors', () => {
  it('throws a typed 401 error that never leaks the key', async () => {
    const { fetchFn } = stubFetch(() => json({}, 401))
    const adapter = createOpenRouterAdapter(fetchFn)
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/401/)
    await adapter.complete(cfg, args).catch((e: Error) => {
      expect(e.message).not.toContain('or-secret-123')
    })
  })

  it('double-fail (free text on both attempts) → actionable "structured output" error', async () => {
    // Every response is free prose: no tool_calls, unparseable content.
    const { fetchFn } = stubFetch(() =>
      json({ choices: [{ message: { content: 'Voici les cartes, sans JSON.' } }] }),
    )
    const adapter = createOpenRouterAdapter(fetchFn)
    await expect(
      runProviderGeneration(adapter, cfg, { content: 'notes', kind: 'cards' }),
    ).rejects.toThrow(/sortie structurée/i)
  })
})

describe('openRouterAdapter.testConnection + listModels', () => {
  it('testConnection ok via GET /key, populating models from /models', async () => {
    const { fetchFn } = stubFetch((url) =>
      url.endsWith('/key')
        ? json({ data: { label: 'ok' } })
        : json({ data: [{ id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' }] }),
    )
    const adapter = createOpenRouterAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(true)
    expect(res.models).toEqual([{ id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' }])
  })

  it('testConnection ok=false on a rejected key (no leak)', async () => {
    const { fetchFn } = stubFetch(() => json({}, 401))
    const adapter = createOpenRouterAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(false)
    expect(res.detailCode).toBe('invalid_key')
    expect(res.httpStatus).toBe(401)
    // The outcome is a fixed enum code, never a message carrying the key.
    expect(JSON.stringify(res)).not.toContain('or-secret-123')
  })
})
