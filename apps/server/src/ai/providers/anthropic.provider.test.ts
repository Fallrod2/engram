import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { createAnthropicAdapter } from './anthropic.provider'
import type { ResolvedProviderConfig } from './types'

const cfg: ResolvedProviderConfig = {
  providerId: 'anthropic',
  model: 'claude-sonnet-4-6',
  keySource: 'app',
  secret: 'sk-ant-test',
}

const args = {
  system: 'sys',
  userText: 'user',
  signal: AbortSignal.timeout(1000),
  attempt: 1,
}

/** Build a fake Anthropic client factory (no network). */
function fakeClient(overrides: {
  create?: () => Promise<unknown>
  list?: () => Promise<unknown>
}): (opts?: { apiKey?: string }) => Anthropic {
  return () =>
    ({
      messages: { create: overrides.create ?? (async () => ({})) },
      models: { list: overrides.list ?? (async () => ({ data: [] })) },
    }) as unknown as Anthropic
}

function toolMessage(cards: unknown, stop: string = 'tool_use') {
  return {
    stop_reason: stop,
    content: [{ type: 'tool_use', id: 't1', name: 'emit_cards', input: { cards } }],
    usage: { input_tokens: 42, output_tokens: 7 },
  }
}

describe('anthropicAdapter.complete', () => {
  it('returns the tool_use input as emitInput + maps token usage', async () => {
    const adapter = createAnthropicAdapter(
      fakeClient({ create: async () => toolMessage([{ front: 'Q', back: 'A' }]) }),
    )
    const res = await adapter.complete(cfg, args)
    expect(res.emitInput).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
    expect(res.promptTokens).toBe(42)
    expect(res.completionTokens).toBe(7)
  })

  it('throws on a max_tokens truncation', async () => {
    const adapter = createAnthropicAdapter(
      fakeClient({ create: async () => toolMessage([{ front: 'Q', back: 'A' }], 'max_tokens') }),
    )
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/truncat/i)
  })

  it('throws when no emit_cards tool block is present', async () => {
    const adapter = createAnthropicAdapter(
      fakeClient({
        create: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'nope' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      }),
    )
    await expect(adapter.complete(cfg, args)).rejects.toThrow(/emit_cards/)
  })
})

describe('anthropicAdapter.testConnection', () => {
  it('ok when models.list succeeds, returning models (no tokens consumed)', async () => {
    const adapter = createAnthropicAdapter(
      fakeClient({
        list: async () => ({ data: [{ id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' }] }),
      }),
    )
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(true)
    expect(res.models).toEqual([{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }])
  })

  it('ok=false with a redacted detail (never the key) on a 401', async () => {
    const adapter = createAnthropicAdapter(
      fakeClient({
        list: async () => {
          throw Object.assign(new Error('unauthorized'), { status: 401 })
        },
      }),
    )
    const res = await adapter.testConnection(cfg)
    expect(res.ok).toBe(false)
    expect(res.detail).toMatch(/401/)
    expect(res.detail).not.toContain('sk-ant-test')
  })
})
