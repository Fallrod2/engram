import { describe, expect, it } from 'vitest'
import { createOpenAiCompatAdapter } from './openai-compat.provider'
import type { FetchFn, ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'openai-compat',
  model: 'local-model',
  keySource: 'app',
  secret: 'compat-secret',
  baseUrl: 'http://127.0.0.1:1234/v1',
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

describe('openAiCompatAdapter.complete', () => {
  it('default strategy is response_format json_schema; parses content JSON', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({
        choices: [{ message: { content: '{"cards":[{"front":"Q","back":"A"}]}' } }],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      }),
    )
    const adapter = createOpenAiCompatAdapter(fetchFn)
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(8)

    const call = calls[0]!
    expect(call.url).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect((call.init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer compat-secret',
    )
    const body = JSON.parse(call.init!.body as string)
    expect(body.response_format.type).toBe('json_schema')
  })

  it('falls back to response_format json_object on attempt 2', async () => {
    const { fetchFn, calls } = stubFetch(() =>
      json({ choices: [{ message: { content: '{"cards":[{"front":"Q","back":"A"}]}' } }] }),
    )
    const adapter = createOpenAiCompatAdapter(fetchFn)
    await adapter.complete(cfg, { ...args, attempt: 2 })
    const body = JSON.parse(calls[0]!.init!.body as string)
    expect(body.response_format.type).toBe('json_object')
  })

  it('requires a base URL', async () => {
    const { fetchFn } = stubFetch(() => json({}))
    const adapter = createOpenAiCompatAdapter(fetchFn)
    await expect(adapter.complete({ ...cfg, baseUrl: '' }, args)).rejects.toThrow(/base URL/i)
  })
})

describe('openAiCompatAdapter.testConnection + listModels', () => {
  it('lists models via GET /models with auth', async () => {
    const { fetchFn, calls } = stubFetch(() => json({ data: [{ id: 'local-model' }] }))
    const adapter = createOpenAiCompatAdapter(fetchFn)
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(true)
    expect(res.models).toEqual([{ id: 'local-model' }])
    expect(calls[0]!.url).toBe('http://127.0.0.1:1234/v1/models')
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer compat-secret',
    )
  })

  it('missing base URL → ok=false', async () => {
    const { fetchFn } = stubFetch(() => json({}))
    const adapter = createOpenAiCompatAdapter(fetchFn)
    const res = await adapter.testConnection({ ...cfg, baseUrl: '' })
    expect(res.ok).toBe(false)
  })
})
