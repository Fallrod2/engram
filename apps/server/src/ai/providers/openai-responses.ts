import { extractJsonEmit } from '../parse'

/**
 * The backend Codex "Responses" transport (SSE). Unlike the Chat Completions
 * helpers in `openai-http.ts`, this endpoint:
 * - REQUIRES `instructions` (the Codex system form) and `store:false`,
 * - carries user content as `input_text` blocks,
 * - STREAMS its answer as Server-Sent Events (audit B7): a `res.json()` would
 *   break, so we accumulate `response.output_text.delta` events and read the
 *   final `response.completed` event for the aggregated text + token usage.
 *
 * We ask for JSON in the instructions and parse it with the shared
 * `extractJsonEmit` (no tools on the subscription backend) — the openai-compat
 * pattern.
 */

/** Extra directive appended to the instructions so the model emits pure JSON. */
const JSON_DIRECTIVE =
  'Réponds UNIQUEMENT avec un objet JSON de forme {"cards":[...]} conforme au schéma demandé, sans texte ni balises autour.'

/** Stronger directive for the 2nd attempt (the 1st returned unparseable text). */
const JSON_DIRECTIVE_STRICT =
  'IMPORTANT : ta réponse précédente n’était pas du JSON exploitable. Renvoie EXCLUSIVEMENT un objet JSON {"cards":[...]} — aucun autre caractère, aucune explication, aucune balise Markdown.'

/**
 * Build the backend request body (Codex/Responses form).
 *
 * When `imageDataUrl` is set (vision/OCR path), the user content also carries an
 * `input_image` block (a bare data-URI string in `image_url`, NOT the Chat
 * Completions `{url}` object — verified in codex-rs protocol/src/models.rs,
 * 14/07/2026) and the JSON directive is dropped: OCR returns free Markdown, not
 * a `{cards}` object. The body allowlist stays STRICT — no field beyond
 * `input_image` is added (leçon du 400 max_output_tokens).
 */
export function buildResponsesBody(args: {
  model: string
  system: string
  userText: string
  reinforceJson: boolean
  imageDataUrl?: string
}): Record<string, unknown> {
  const instructions = args.imageDataUrl
    ? args.system
    : `${args.system}\n\n${args.reinforceJson ? JSON_DIRECTIVE_STRICT : JSON_DIRECTIVE}`
  const content: Record<string, unknown>[] = [{ type: 'input_text', text: args.userText }]
  if (args.imageDataUrl) {
    content.push({ type: 'input_image', image_url: args.imageDataUrl })
  }
  return {
    model: args.model,
    instructions,
    input: [
      {
        type: 'message',
        role: 'user',
        content,
      },
    ],
    store: false,
    stream: true,
    // NO max_output_tokens: the subscription backend validates a strict
    // parameter allowlist and 400s on it ("Unsupported parameter") — confirmed
    // by litellm#21193, codex-proxy API.md and opencode-openai-codex-auth,
    // and hit on Alex's real linked account (14/07/2026).
  }
}

export interface ResponsesResult {
  /** Aggregated assistant text (the JSON the model emitted). */
  text: string
  promptTokens: number
  completionTokens: number
}

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
}
interface ResponsesEvent {
  type?: string
  delta?: string
  response?: {
    output_text?: string | string[]
    output?: { content?: { type?: string; text?: string }[] }[]
    usage?: ResponsesUsage
  }
  usage?: ResponsesUsage
}

/**
 * Parse the SSE body of a Responses call. The completed event carries the
 * AUTHORITATIVE full text, so we track streamed deltas and the completed text
 * separately and prefer the latter (avoids double-counting when a server both
 * streams deltas and repeats the whole text at the end). Tolerant of a
 * non-streaming single-object body.
 */
export function parseResponsesSse(raw: string): ResponsesResult {
  let deltaText = ''
  let completedText = '' // authoritative full text from the completed event
  let promptTokens = 0
  let completionTokens = 0
  let sawEvent = false

  const handle = (evt: ResponsesEvent): void => {
    if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
      deltaText += evt.delta
    }
    const usage = evt.response?.usage ?? evt.usage
    if (usage) {
      promptTokens = usage.input_tokens ?? promptTokens
      completionTokens = usage.output_tokens ?? completionTokens
    }
    const agg = aggregateOutput(evt.response)
    if (agg !== null && agg.length > 0) completedText = agg
  }

  for (const block of raw.split('\n\n')) {
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) continue
    const data = dataLines.join('')
    if (data === '[DONE]') continue
    try {
      handle(JSON.parse(data) as ResponsesEvent)
      sawEvent = true
    } catch {
      /* skip non-JSON keepalive lines */
    }
  }

  // Fallback: a single non-SSE JSON object body.
  if (!sawEvent) {
    try {
      handle(JSON.parse(raw.trim()) as ResponsesEvent)
    } catch {
      /* leave text empty → the adapter raises unstructuredOutputError */
    }
  }

  return {
    text: completedText.length > 0 ? completedText : deltaText,
    promptTokens,
    completionTokens,
  }
}

/** Extract the final text from a completed `response` object, if present. */
function aggregateOutput(r: ResponsesEvent['response']): string | null {
  if (!r) return null
  if (typeof r.output_text === 'string') return r.output_text
  if (Array.isArray(r.output_text)) return r.output_text.join('')
  if (Array.isArray(r.output)) {
    const parts: string[] = []
    for (const item of r.output) {
      for (const c of item.content ?? []) {
        if (typeof c.text === 'string') parts.push(c.text)
      }
    }
    if (parts.length > 0) return parts.join('')
  }
  return null
}

/** Parse the aggregated text into an emit object (or null → unstructured error). */
export function emitFromResponses(result: ResponsesResult): unknown | null {
  const text = result.text.trim()
  if (text.length === 0) return null
  try {
    return extractJsonEmit(text)
  } catch {
    return null
  }
}
