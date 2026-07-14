import { EMIT_CARDS_DESCRIPTION, EMIT_CARDS_JSON_SCHEMA } from '../prompts/cards.v1'
import {
  defaultFetch,
  MAX_OUTPUT_TOKENS,
  MISTRAL_DEFAULT_BASE_URL,
  toBase64,
  unstructuredOutputError,
} from './constants'
import {
  emitFromMessage,
  textFromChat,
  tokensOf,
  visionMessages,
  type OpenAiChatResponse,
} from './openai-http'
import { openAiCompatSupportsVision } from './vision-support'
import type {
  FetchFn,
  ProviderAdapter,
  ProviderModel,
  ProviderVisionArgs,
  ProviderVisionResult,
  ResolvedProviderConfig,
} from './types'

/** Response of `POST /v1/ocr` — the dedicated OCR API (no chat, no prompt). */
interface MistralOcrResponse {
  pages?: { index?: number; markdown?: string }[]
  usage_info?: { pages_processed?: number; doc_size_bytes?: number }
}

/**
 * `${base}` already ends in `/v1` (the default or a proxy override), so the
 * endpoints are `${base}/ocr`, `${base}/chat/completions`, `${base}/models` —
 * never a double `/v1/v1`.
 */
function baseUrlOf(cfg: ResolvedProviderConfig): string {
  const b = cfg.baseUrl?.trim()
  return (b && b.length > 0 ? b : MISTRAL_DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function authHeaders(cfg: ResolvedProviderConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.secret ?? ''}`, 'Content-Type': 'application/json' }
}

/** An OCR model targets the dedicated `/v1/ocr` API (e.g. `mistral-ocr-latest`). */
function isOcrModel(model: string): boolean {
  return model.toLowerCase().includes('ocr')
}

/**
 * Mistral adapter. Card generation + chat-vision go through Mistral's
 * OpenAI-compatible Chat Completions API (`/v1/chat/completions`); photo OCR on
 * an `*-ocr-*` model goes through the DEDICATED `/v1/ocr` endpoint, which returns
 * faithful Markdown directly (no system prompt — the field does not exist there).
 * `complete` reuses OpenRouter's 2-attempt strategy (tools → json_schema), which
 * the Mistral API supports (function calling + structured outputs). Never logs
 * or interpolates the key.
 */
export function createMistralAdapter(fetchFn: FetchFn = defaultFetch): ProviderAdapter {
  /** OCR path: `POST /v1/ocr` with a base64 data URI, join `pages[].markdown`. */
  async function ocrExtract(
    base: string,
    cfg: ResolvedProviderConfig,
    args: ProviderVisionArgs,
  ): Promise<ProviderVisionResult> {
    const body = {
      model: cfg.model,
      document: {
        type: 'image_url',
        image_url: `data:${args.mediaType};base64,${toBase64(args.image)}`,
      },
    }
    const res = await fetchFn(`${base}/ocr`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
      signal: args.signal,
    })
    if (!res.ok) throw mistralHttpError(res.status)
    const json = (await res.json()) as MistralOcrResponse
    const markdown = (json.pages ?? [])
      .map((p) => p.markdown ?? '')
      .filter((m) => m.length > 0)
      .join('\n\n')
    // The OCR API reports `usage_info` (pages/bytes), not prompt/completion
    // tokens — the vision contract needs numbers, so report 0 on this path.
    return { markdown, promptTokens: 0, completionTokens: 0 }
  }

  /** Chat-vision path: multimodal chat (pixtral / mistral-small-3.x). */
  async function chatVision(
    base: string,
    cfg: ResolvedProviderConfig,
    args: ProviderVisionArgs,
  ): Promise<ProviderVisionResult> {
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
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
      signal: args.signal,
    })
    if (!res.ok) throw mistralHttpError(res.status)
    const json = (await res.json()) as OpenAiChatResponse
    return { markdown: textFromChat(json), ...tokensOf(json) }
  }

  return {
    id: 'mistral',
    requiresKey: true,

    async complete(cfg, args) {
      const base = baseUrlOf(cfg)
      const useTools = args.attempt < 2
      // v1 schema by default (cards/quiz); mixed supplies the v2 schema via `emit`.
      const emitDescription = args.emit?.description ?? EMIT_CARDS_DESCRIPTION
      const emitSchema = args.emit?.schema ?? EMIT_CARDS_JSON_SCHEMA
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
                  description: emitDescription,
                  parameters: emitSchema,
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
              json_schema: { name: 'emit_cards', schema: emitSchema, strict: true },
            },
          }

      const res = await fetchFn(`${base}/chat/completions`, {
        method: 'POST',
        headers: authHeaders(cfg),
        body: JSON.stringify(body),
        signal: args.signal,
      })
      if (!res.ok) throw mistralHttpError(res.status)

      const json = (await res.json()) as OpenAiChatResponse
      const emitInput = emitFromMessage(json)
      if (emitInput === null) throw unstructuredOutputError(cfg.model)
      return { emitInput, ...tokensOf(json) }
    },

    async testConnection(cfg) {
      const base = baseUrlOf(cfg)
      try {
        // Validate the key via GET /v1/models — cheap, no OCR credits consumed.
        const res = await fetchFn(`${base}/models`, { headers: authHeaders(cfg) })
        if (!res.ok) {
          if (res.status === 401) return { ok: false, detailCode: 'invalid_key', httpStatus: 401 }
          if (res.status === 403) return { ok: false, detailCode: 'forbidden', httpStatus: 403 }
          return { ok: false, detailCode: 'http_error', httpStatus: res.status }
        }
        const json = (await res.json()) as { data?: { id: string }[] }
        const models: ProviderModel[] = (json.data ?? []).map((m) => ({ id: m.id }))
        return { ok: true, detailCode: 'ok', models }
      } catch {
        return { ok: false, detailCode: 'unreachable' }
      }
    },

    async listModels(cfg) {
      const base = baseUrlOf(cfg)
      const res = await fetchFn(`${base}/models`, { headers: authHeaders(cfg) })
      if (!res.ok) throw mistralHttpError(res.status)
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => ({ id: m.id }))
    },

    // Cloud provider — permissive, like openai-compat/openrouter. The concrete
    // transport (OCR vs chat) is chosen from the model name in completeVision.
    supportsVision() {
      return openAiCompatSupportsVision()
    },

    async completeVision(cfg, args) {
      const base = baseUrlOf(cfg)
      return isOcrModel(cfg.model) ? ocrExtract(base, cfg, args) : chatVision(base, cfg, args)
    },
  }
}

/** HTTP error → actionable message. NEVER includes the key or auth header. */
function mistralHttpError(status: number): Error {
  if (status === 401)
    return new Error('Requête Mistral refusée (401) — vérifie ta clé API Mistral.')
  if (status === 429)
    return new Error('Limite de débit Mistral atteinte (429) — réessaie dans un instant.')
  return new Error(`Requête Mistral échouée (HTTP ${status}).`)
}

export const mistralAdapter = createMistralAdapter()
