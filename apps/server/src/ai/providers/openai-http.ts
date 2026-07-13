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

/** The assistant message text (free-text completion, e.g. an OCR transcription). */
export function textFromChat(json: OpenAiChatResponse): string {
  const content = json.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

/**
 * OpenAI-compatible `messages` for a single-image vision call: a system prompt
 * plus a user turn carrying the instruction and the image as a `data:` URI
 * (`image_url`). Shared by OpenRouter and the generic OpenAI-compat adapter.
 */
export function visionMessages(args: {
  system: string
  instruction: string
  base64: string
  mediaType: string
}): unknown[] {
  return [
    { role: 'system', content: args.system },
    {
      role: 'user',
      content: [
        { type: 'text', text: args.instruction },
        { type: 'image_url', image_url: { url: `data:${args.mediaType};base64,${args.base64}` } },
      ],
    },
  ]
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
