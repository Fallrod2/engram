import { createAnthropic, type CreateAnthropic } from '../client'
import { extractAnthropicToolInput } from '../parse'
import { EMIT_CARDS_TOOL } from '../prompts/cards.v1'
import { MAX_OUTPUT_TOKENS } from './constants'
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
      const res = await client.messages.create(
        {
          model: cfg.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: args.system,
          tools: [EMIT_CARDS_TOOL],
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
        return { ok: true, detail: 'Connexion établie', models }
      } catch (e) {
        return { ok: false, detail: redactAnthropicError(e) }
      }
    },
  }
}

/** Map an SDK error to a short message that NEVER contains the key or headers. */
function redactAnthropicError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status
  if (status === 401) return 'Clé invalide (401)'
  if (status === 403) return 'Accès refusé (403)'
  if (typeof status === 'number') return `Échec de la connexion (HTTP ${status})`
  return 'Connexion impossible (aucune credential Anthropic valide)'
}

/** Default instance (real credential chain). Tests build their own with a fake. */
export const anthropicAdapter = createAnthropicAdapter()
