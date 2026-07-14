import {
  CODEX_MODELS,
  CODEX_OPENAI_BETA,
  CODEX_ORIGINATOR,
  codexResponsesUrl,
} from './codex-constants'
import { defaultFetch, unstructuredOutputError } from './constants'
import { buildResponsesBody, emitFromResponses, parseResponsesSse } from './openai-responses'
import type { FetchFn, ProviderAdapter, ProviderModel, ResolvedProviderConfig } from './types'

/**
 * Adapter for the ChatGPT/Codex SUBSCRIPTION backend (OAuth device-code linked).
 * Talks to `backend-api/codex/responses` (SSE) with a short-lived access token +
 * account id resolved upstream in `cfg.oauth` (the resolver refreshes it). NO
 * vision transport (→ automatic 503 for OCR). NEVER logs the token.
 *
 * Experimental: this rides OpenAI's tolerance of subscription OAuth in
 * third-party tools (see docs/subscription-providers-research.md) and may stop
 * working — the UI labels it as such and a kill-switch gates it server-side.
 */

/** Required auth + Codex headers. Throws (caught upstream) if oauth is missing. */
function codexHeaders(cfg: ResolvedProviderConfig): Record<string, string> {
  const oauth = cfg.oauth
  if (!oauth?.accessToken) throw new Error('openai-codex: compte non lié (aucun token)')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${oauth.accessToken}`,
    'OpenAI-Beta': CODEX_OPENAI_BETA,
    originator: CODEX_ORIGINATOR,
    Accept: 'text/event-stream',
  }
  if (oauth.accountId) headers['chatgpt-account-id'] = oauth.accountId
  return headers
}

/**
 * HTTP status → adapter error (never carries the token). The backend answers
 * errors with an explicit JSON `{"detail":"…"}` body (e.g. "Unsupported
 * parameter: max_output_tokens") — surface it so the next contract mismatch
 * names itself instead of hiding behind a bare status code.
 */
function codexHttpError(status: number, detail?: string): Error {
  const suffix = detail ? ` — ${detail}` : ''
  if (status === 401)
    return new Error(`Requête Codex refusée (401) — relie ton compte ChatGPT.${suffix}`)
  if (status === 403)
    return new Error(`Accès Codex refusé (403) — abonnement ou permissions insuffisants.${suffix}`)
  if (status === 429)
    return new Error(`Limite d’abonnement ChatGPT atteinte (429) — réessaie plus tard.${suffix}`)
  return new Error(`Requête Codex échouée (HTTP ${status})${suffix ? suffix : '.'}`)
}

/** Read the backend's `{"detail":"…"}` error body, best effort, token-safe. */
async function codexErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await res.text()) as { detail?: unknown }
    if (typeof parsed.detail === 'string' && parsed.detail.length > 0) {
      return parsed.detail.slice(0, 200)
    }
  } catch {
    /* non-JSON error body — keep the bare status */
  }
  return undefined
}

export function createOpenAiCodexAdapter(fetchFn: FetchFn = defaultFetch): ProviderAdapter {
  async function callResponses(
    cfg: ResolvedProviderConfig,
    args: { system: string; userText: string; reinforceJson: boolean; signal?: AbortSignal },
  ): Promise<Response> {
    const body = buildResponsesBody({
      model: cfg.model,
      system: args.system,
      userText: args.userText,
      reinforceJson: args.reinforceJson,
    })
    return fetchFn(codexResponsesUrl(), {
      method: 'POST',
      headers: codexHeaders(cfg),
      body: JSON.stringify(body),
      ...(args.signal ? { signal: args.signal } : {}),
    })
  }

  return {
    id: 'openai-codex',
    requiresKey: true,

    async complete(cfg, args) {
      const res = await callResponses(cfg, {
        system: args.system,
        userText: args.userText,
        reinforceJson: args.attempt >= 2,
        signal: args.signal,
      })
      if (!res.ok) throw codexHttpError(res.status, await codexErrorDetail(res))
      const parsed = parseResponsesSse(await res.text())
      const emitInput = emitFromResponses(parsed)
      if (emitInput === null) throw unstructuredOutputError(cfg.model)
      return {
        emitInput,
        promptTokens: parsed.promptTokens,
        completionTokens: parsed.completionTokens,
      }
    },

    async testConnection(cfg) {
      // NOTE (audit C16a): the subscription backend has no free probe, so this
      // consumes ONE message of the user's quota. Kept minimal (tiny prompt).
      if (!cfg.oauth?.accessToken) return { ok: false, detailCode: 'no_credentials' }
      try {
        const res = await callResponses(cfg, {
          system: 'You are a health check. Reply with the single word ok.',
          userText: 'ping',
          reinforceJson: false,
        })
        if (res.ok) return { ok: true, detailCode: 'ok' }
        if (res.status === 401) return { ok: false, detailCode: 'invalid_key', httpStatus: 401 }
        if (res.status === 403) return { ok: false, detailCode: 'forbidden', httpStatus: 403 }
        return { ok: false, detailCode: 'http_error', httpStatus: res.status }
      } catch {
        return { ok: false, detailCode: 'unreachable' }
      }
    },

    // Static presets: the subscription backend exposes no reliable list endpoint.
    async listModels(): Promise<ProviderModel[]> {
      return CODEX_MODELS.map((id) => ({ id }))
    },

    // No `supportsVision`/`completeVision`: OCR pointed at codex 503s cleanly.
  }
}

export const openAiCodexAdapter = createOpenAiCodexAdapter()
