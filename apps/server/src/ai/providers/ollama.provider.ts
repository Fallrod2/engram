import { extractJsonEmit } from '../parse'
import { EMIT_CARDS_DESCRIPTION, EMIT_CARDS_JSON_SCHEMA } from '../prompts/cards.v1'
import {
  defaultFetch,
  MAX_OUTPUT_TOKENS,
  OLLAMA_DEFAULT_BASE_URL,
  unstructuredOutputError,
} from './constants'
import type { FetchFn, ProviderAdapter, ProviderModel, ResolvedProviderConfig } from './types'

/** Native Ollama `/api/chat` message shape (structured output + tool calls). */
interface OllamaChatResponse {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
  }
  prompt_eval_count?: number
  eval_count?: number
}

function baseUrlOf(cfg: ResolvedProviderConfig): string {
  const b = cfg.baseUrl?.trim()
  return (b && b.length > 0 ? b : OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Ollama adapter (local, no key). Default strategy is native structured output
 * (`format` = JSON Schema) — more reliable than tool calling on small local
 * models. The 2nd attempt falls back to native tool calling. No `Authorization`
 * header is ever sent.
 */
export function createOllamaAdapter(fetchFn: FetchFn = defaultFetch): ProviderAdapter {
  return {
    id: 'ollama',
    requiresKey: false,

    async complete(cfg, args) {
      const base = baseUrlOf(cfg)
      const useTools = args.attempt >= 2
      const body = {
        model: cfg.model,
        stream: false,
        options: { num_predict: MAX_OUTPUT_TOKENS },
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.userText },
        ],
        ...(useTools
          ? {
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
            }
          : { format: EMIT_CARDS_JSON_SCHEMA }),
      }

      const res = await fetchFn(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) throw new Error(`Requête Ollama échouée (HTTP ${res.status}).`)

      const json = (await res.json()) as OllamaChatResponse
      const tokens = {
        promptTokens: json.prompt_eval_count ?? 0,
        completionTokens: json.eval_count ?? 0,
      }

      const call = json.message?.tool_calls?.[0]?.function?.arguments
      if (call !== undefined && call !== null && typeof call === 'object') {
        return { emitInput: call, ...tokens }
      }
      const content = json.message?.content
      if (typeof content === 'string' && content.trim().length > 0) {
        return { emitInput: extractJsonEmit(content), ...tokens }
      }
      throw unstructuredOutputError(cfg.model)
    },

    async testConnection(cfg) {
      try {
        const models = await this.listModels!(cfg)
        return { ok: true, detail: `Ollama joignable (${models.length} modèle(s))`, models }
      } catch {
        return { ok: false, detail: 'Ollama injoignable — vérifie que le serveur tourne.' }
      }
    },

    async listModels(cfg) {
      const base = baseUrlOf(cfg)
      const res = await fetchFn(`${base}/api/tags`)
      if (!res.ok) throw new Error(`Ollama /api/tags échoué (HTTP ${res.status}).`)
      const json = (await res.json()) as {
        models?: { name?: string; model?: string; details?: { parameter_size?: string } }[]
      }
      const models: ProviderModel[] = (json.models ?? [])
        .map((m) => {
          const id = m.name ?? m.model
          if (!id) return null
          const size = m.details?.parameter_size
          return { id, ...(size ? { label: `${id} · ${size}` } : {}) }
        })
        .filter((m): m is ProviderModel => m !== null)
      return models
    },
  }
}

export const ollamaAdapter = createOllamaAdapter()
