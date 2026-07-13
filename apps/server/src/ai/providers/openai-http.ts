import { extractJsonEmit } from '../parse'

/** Minimal shape of an OpenAI-compatible Chat Completions response. */
export interface OpenAiChatResponse {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { function?: { name?: string; arguments?: unknown } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export function tokensOf(json: OpenAiChatResponse): {
  promptTokens: number
  completionTokens: number
} {
  return {
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
  }
}

/**
 * Normalise an OpenAI-compatible message into an `emitInput` object. Prefers a
 * function/tool call (`arguments` string→parse, or already-object), else falls
 * back to parsing the message text as JSON. Returns `null` if neither yields a
 * usable object — the caller turns that into an actionable error.
 */
export function emitFromMessage(json: OpenAiChatResponse): unknown | null {
  const message = json.choices?.[0]?.message
  const call = message?.tool_calls?.[0]?.function
  if (call?.arguments !== undefined) {
    if (typeof call.arguments === 'string') {
      try {
        return JSON.parse(call.arguments)
      } catch {
        /* fall through to content */
      }
    } else if (call.arguments !== null && typeof call.arguments === 'object') {
      return call.arguments
    }
  }
  const content = message?.content
  if (typeof content === 'string' && content.trim().length > 0) {
    try {
      return extractJsonEmit(content)
    } catch {
      return null
    }
  }
  return null
}
