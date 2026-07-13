import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'

export const emitCardsInputSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1),
        back: z.string().trim().min(1),
      }),
    )
    // Bound aligned with MAX_TOKENS=8192: ~24 front/back Markdown cards fit well
    // under 8k output tokens. The prompt (rule 8) already caps at 24 — this is
    // the realistic per-call ceiling, not a distant safety valve.
    .max(24),
})

/**
 * THE single Zod validation point, shared by every provider: takes a raw
 * `emitInput` object (a tool-call input, or a JSON-mode object) and returns the
 * validated cards. Throws (ZodError) on any non-conforming shape.
 */
export function parseEmitCardsInput(input: unknown): { front: string; back: string }[] {
  return emitCardsInputSchema.parse(input).cards
}

/**
 * Extract the `emit_cards` tool_use input from an Anthropic response (does NOT
 * validate — the caller runs it through `parseEmitCardsInput`). Throws if the
 * output was truncated (stop_reason max_tokens) or no matching tool block is
 * present.
 */
export function extractAnthropicToolInput(res: Anthropic.Message): unknown {
  // Truncation guard: if the model was cut at max_tokens, the tool JSON may be
  // partial/invalid. Throw explicitly to trigger the retry rather than letting a
  // lucky parse slip through.
  if (res.stop_reason === 'max_tokens') {
    throw new Error('generation: model output truncated (max_tokens) — reduce chunk size')
  }
  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_cards',
  )
  if (!block) throw new Error('generation: no emit_cards tool_use block in response')
  return block.input
}

/**
 * Extract the `emit_cards` tool_use block from an Anthropic response and validate
 * its input. Throws if: output was truncated (stop_reason max_tokens), no tool
 * block is present, the tool name is wrong, or the input is non-conforming.
 * Kept as the Anthropic-specific convenience used by the legacy generator.
 */
export function parseEmitCards(res: Anthropic.Message): { front: string; back: string }[] {
  return parseEmitCardsInput(extractAnthropicToolInput(res))
}

/**
 * Defensive JSON extraction for providers in JSON mode (Ollama, openai-compat,
 * openrouter json_schema fallback). Strips ```json fences, extracts the first
 * balanced `{...}` object, and `JSON.parse`s it. Returns the parsed object
 * (which the caller passes to `parseEmitCardsInput`). Throws a clear message if
 * no JSON object is recoverable — the model replied in free text.
 */
export function extractJsonEmit(text: string): unknown {
  const raw = (text ?? '').trim()
  if (raw.length === 0) {
    throw new Error('generation: empty model response (no JSON)')
  }
  // Strip a leading ```json / ``` fence and its closing counterpart, if present.
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  // Fast path: the whole thing is a JSON object.
  const trimmed = fenced.trim()
  if (trimmed.startsWith('{')) {
    const balanced = firstBalancedObject(trimmed)
    if (balanced !== null) {
      return JSON.parse(balanced)
    }
  }

  // Otherwise, find the first balanced object anywhere in the text.
  const start = fenced.indexOf('{')
  if (start !== -1) {
    const balanced = firstBalancedObject(fenced.slice(start))
    if (balanced !== null) {
      return JSON.parse(balanced)
    }
  }

  throw new Error(
    'generation: no JSON object in model response — the model did not return structured output',
  )
}

/**
 * Return the first balanced `{...}` substring starting at index 0 of `s`
 * (string-aware: braces inside JSON strings are ignored), or null if the object
 * never closes. `s` must start with `{`.
 */
function firstBalancedObject(s: string): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(0, i + 1)
    }
  }
  return null
}
