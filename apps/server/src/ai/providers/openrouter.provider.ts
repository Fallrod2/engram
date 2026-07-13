import { EMIT_CARDS_DESCRIPTION, EMIT_CARDS_JSON_SCHEMA } from '../prompts/cards.v1'
import {
  defaultFetch,
  MAX_OUTPUT_TOKENS,
  OPENROUTER_DEFAULT_BASE_URL,
  unstructuredOutputError,
} from './constants'
import { emitFromMessage, tokensOf, type OpenAiChatResponse } from './openai-http'
import type { FetchFn, ProviderAdapter, ProviderModel, ResolvedProviderConfig } from './types'

/** Attribution headers recommended by OpenRouter (ranking only, no secret). */
const ATTRIBUTION = {
  'HTTP-Referer': 'http://localhost:5173',
  'X-Title': 'engram',
}

function baseUrlOf(cfg: ResolvedProviderConfig): string {
  const b = cfg.baseUrl?.trim()
  return (b && b.length > 0 ? b : OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * OpenRouter adapter (OpenAI-compatible over `fetch`). Default strategy is
 * function calling; the 2nd attempt (or a tool-less model) falls back to
 * `response_format: json_schema`. Never logs or interpolates the key.
 */
export function createOpenRouterAdapter(fetchFn: FetchFn = defaultFetch): ProviderAdapter {
  return {
    id: 'openrouter',
    requiresKey: true,

    async complete(cfg, args) {
      const base = baseUrlOf(cfg)
      const useTools = args.attempt < 2
      const body = useTools
        ? {
            model: cfg.model,
            max_tokens: MAX_OUTPUT_TOKENS,
            messages: [
              { role: 'system', content: args.system },
              { role: 'user', content: args.userText },
            ],
            tools: [
              {
                type: 'function',
                function: {
                  name: 'emit_cards',
                  description: EMIT_CARDS_DESCRIPTION,
                  parameters: EMIT_CARDS_JSON_SCHEMA,
                },
              },
            ],
            tool_choice: { type: 'function', function: { name: 'emit_cards' } },
          }
        : {
            model: cfg.model,
            max_tokens: MAX_OUTPUT_TOKENS,
            messages: [
              { role: 'system', content: args.system },
              { role: 'user', content: args.userText },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'emit_cards', schema: EMIT_CARDS_JSON_SCHEMA, strict: true },
            },
          }

      const res = await fetchFn(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.secret ?? ''}`,
          'Content-Type': 'application/json',
          ...ATTRIBUTION,
        },
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) throw openRouterHttpError(res.status)

      const json = (await res.json()) as OpenAiChatResponse
      const emitInput = emitFromMessage(json)
      if (emitInput === null) throw unstructuredOutputError(cfg.model)
      return { emitInput, ...tokensOf(json) }
    },

    async testConnection(cfg) {
      const base = baseUrlOf(cfg)
      try {
        const res = await fetchFn(`${base}/key`, {
          headers: { Authorization: `Bearer ${cfg.secret ?? ''}`, ...ATTRIBUTION },
        })
        if (!res.ok) return { ok: false, detailCode: 'invalid_key', httpStatus: res.status }
        // Best-effort model list to populate the dropdown (never fatal).
        const models = await this.listModels?.(cfg).catch(() => undefined)
        return { ok: true, detailCode: 'ok', ...(models ? { models } : {}) }
      } catch {
        return { ok: false, detailCode: 'unreachable' }
      }
    },

    async listModels(cfg) {
      const base = baseUrlOf(cfg)
      const res = await fetchFn(`${base}/models`, {
        headers: { Authorization: `Bearer ${cfg.secret ?? ''}`, ...ATTRIBUTION },
      })
      if (!res.ok) throw openRouterHttpError(res.status)
      const json = (await res.json()) as { data?: { id: string; name?: string }[] }
      const models: ProviderModel[] = (json.data ?? []).map((m) => ({
        id: m.id,
        ...(m.name ? { label: m.name } : {}),
      }))
      return models
    },
  }
}

/** HTTP error → actionable message. NEVER includes the key or auth header. */
function openRouterHttpError(status: number): Error {
  if (status === 401)
    return new Error('Requête OpenRouter refusée (401) — vérifie ta clé et tes crédits OpenRouter.')
  if (status === 402)
    return new Error('Crédits OpenRouter insuffisants (402) — recharge ton compte OpenRouter.')
  return new Error(`Requête OpenRouter échouée (HTTP ${status}).`)
}

export const openRouterAdapter = createOpenRouterAdapter()
