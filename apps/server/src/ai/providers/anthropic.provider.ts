import { createAnthropic, type CreateAnthropic } from '../client'
import { extractAnthropicToolInput } from '../parse'
import { EMIT_CARDS_TOOL } from '../prompts/cards.v1'
import { MAX_OUTPUT_TOKENS, toBase64 } from './constants'
import { anthropicSupportsVision } from './vision-support'
import type { TestConnectionDetailCode } from '@engram/shared'
import type { ProviderAdapter, ResolvedProviderConfig, ProviderModel } from './types'

/**
 * Anthropic adapter — uses the official SDK (credential chain resolved by
 * `new Anthropic()`, or an explicit stored key). Forces the `emit_cards` tool,
 * which is the reliable structured-output path (no JSON parsing needed).
 */
export function createAnthropicAdapter(
  createClient: CreateAnthropic = createAnthropic,
): ProviderAdapter {
  /** Build the SDK client for a resolved config: explicit key iff stored in-app. */
  const clientFor = (cfg: ResolvedProviderConfig) =>
    createClient(cfg.keySource === 'app' && cfg.secret ? { apiKey: cfg.secret } : undefined)

  return {
    id: 'anthropic',
    requiresKey: true,

    async complete(cfg, args) {
      const client = clientFor(cfg)
      // v1 tool by default (cards/quiz); the orchestrator supplies `emit.tool`
      // for the mixed kind (v2 qa|cloze schema). Both are named `emit_cards`.
      const tool = args.emit?.tool ?? EMIT_CARDS_TOOL
      const res = await client.messages.create(
        {
          model: cfg.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: args.system,
          tools: [tool],
          tool_choice: { type: 'tool', name: 'emit_cards' },
          messages: [{ role: 'user', content: args.userText }],
        },
        { signal: args.signal },
      )
      return {
        emitInput: extractAnthropicToolInput(res),
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
      }
    },

    async testConnection(cfg) {
      try {
        const client = clientFor(cfg)
        // Validates the key / machine credentials WITHOUT consuming tokens.
        const page = await client.models.list({ limit: 20 })
        const models: ProviderModel[] = page.data.map((m) => ({
          id: m.id,
          ...(m.display_name ? { label: m.display_name } : {}),
        }))
        return { ok: true, detailCode: 'ok', models }
      } catch (e) {
        return { ok: false, ...classifyAnthropicError(e) }
      }
    },

    supportsVision(cfg) {
      return anthropicSupportsVision(cfg.model)
    },

    async completeVision(cfg, args) {
      const client = clientFor(cfg)
      const res = await client.messages.create(
        {
          model: cfg.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: args.system,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: args.mediaType,
                    data: toBase64(args.image),
                  },
                },
                { type: 'text', text: args.instruction },
              ],
            },
          ],
        },
        { signal: args.signal },
      )
      const markdown = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')
      return {
        markdown,
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
      }
    },
  }
}

/** Map an SDK error to an i18n-neutral code that NEVER carries the key/headers. */
function classifyAnthropicError(e: unknown): {
  detailCode: TestConnectionDetailCode
  httpStatus?: number
} {
  const status = (e as { status?: number } | null)?.status
  if (status === 401) return { detailCode: 'invalid_key', httpStatus: 401 }
  if (status === 403) return { detailCode: 'forbidden', httpStatus: 403 }
  if (typeof status === 'number') return { detailCode: 'http_error', httpStatus: status }
  return { detailCode: 'no_credentials' }
}

/** Default instance (real credential chain). Tests build their own with a fake. */
export const anthropicAdapter = createAnthropicAdapter()
