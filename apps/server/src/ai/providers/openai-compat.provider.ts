import { EMIT_CARDS_JSON_SCHEMA } from '../prompts/cards.v1'
import { defaultFetch, MAX_OUTPUT_TOKENS, toBase64, unstructuredOutputError } from './constants'
import {
  emitFromMessage,
  textFromChat,
  tokensOf,
  visionMessages,
  type OpenAiChatResponse,
} from './openai-http'
import { openAiCompatSupportsVision } from './vision-support'
import type { FetchFn, ProviderAdapter, ProviderModel, ResolvedProviderConfig } from './types'

function baseUrlOf(cfg: ResolvedProviderConfig): string {
  return (cfg.baseUrl ?? '').trim().replace(/\/+$/, '')
}

function authHeaders(cfg: ResolvedProviderConfig): Record<string, string> {
  return cfg.secret ? { Authorization: `Bearer ${cfg.secret}` } : {}
}

/**
 * Generic OpenAI-compatible adapter (LM Studio, vLLM, Together, Groq…). Default
 * strategy is `response_format: json_schema` (most portable); the 2nd attempt
 * falls back to `json_object` (schema described in the prompt). Requires a base
 * URL. Never logs or interpolates the key.
 */
export function createOpenAiCompatAdapter(fetchFn: FetchFn = defaultFetch): ProviderAdapter {
  return {
    id: 'openai-compat',
    requiresKey: true,

    async complete(cfg, args) {
      const base = baseUrlOf(cfg)
      if (base.length === 0) throw new Error('openai-compat: base URL manquante')
      const useJsonObject = args.attempt >= 2
      const body = {
        model: cfg.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.userText },
        ],
        response_format: useJsonObject
          ? { type: 'json_object' }
          : {
              type: 'json_schema',
              json_schema: { name: 'emit_cards', schema: EMIT_CARDS_JSON_SCHEMA, strict: true },
            },
      }

      const res = await fetchFn(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) throw new Error(`Requête serveur échouée (HTTP ${res.status}).`)

      const json = (await res.json()) as OpenAiChatResponse
      const emitInput = emitFromMessage(json)
      if (emitInput === null) throw unstructuredOutputError(cfg.model)
      return { emitInput, ...tokensOf(json) }
    },

    async testConnection(cfg) {
      const base = baseUrlOf(cfg)
      if (base.length === 0) return { ok: false, detailCode: 'incomplete_config' }
      try {
        const models = await this.listModels!(cfg)
        return { ok: true, detailCode: 'ok', models }
      } catch {
        // Constructed outcome (like the other adapters) — never surface the raw
        // runtime/HTTP error message, which is not i18n-neutral or controlled.
        return { ok: false, detailCode: 'unreachable' }
      }
    },

    async listModels(cfg) {
      const base = baseUrlOf(cfg)
      const res = await fetchFn(`${base}/models`, { headers: authHeaders(cfg) })
      if (!res.ok) throw new Error(`Endpoint /models refusé (HTTP ${res.status}).`)
      const json = (await res.json()) as { data?: { id: string }[] }
      const models: ProviderModel[] = (json.data ?? []).map((m) => ({ id: m.id }))
      return models
    },

    supportsVision() {
      return openAiCompatSupportsVision()
    },

    async completeVision(cfg, args) {
      const base = baseUrlOf(cfg)
      if (base.length === 0) throw new Error('openai-compat: base URL manquante')
      const body = {
        model: cfg.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: visionMessages({
          system: args.system,
          instruction: args.instruction,
          base64: toBase64(args.image),
          mediaType: args.mediaType,
        }),
      }
      const res = await fetchFn(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) throw new Error(`Requête serveur échouée (HTTP ${res.status}).`)
      const json = (await res.json()) as OpenAiChatResponse
      return { markdown: textFromChat(json), ...tokensOf(json) }
    },
  }
}

export const openAiCompatAdapter = createOpenAiCompatAdapter()
