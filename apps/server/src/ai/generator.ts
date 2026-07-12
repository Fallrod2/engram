import type Anthropic from '@anthropic-ai/sdk'
import type { GenerationKind } from '@engram/shared'
import { createAnthropic } from './client'
import {
  GENERATION_MODEL,
  SYSTEM_PROMPT,
  EMIT_CARDS_TOOL,
  CARDS_INSTRUCTIONS,
  QUIZ_INSTRUCTIONS,
} from './prompts/cards.v1'
import { parseEmitCards } from './parse'

export interface GeneratedCardDraft {
  front: string
  back: string
}

export interface GenerateArgs {
  /** Text of the extract (one chunk). */
  content: string
  kind: GenerationKind
  /** Optional external cancellation signal (combined with the internal timeout). */
  signal?: AbortSignal
}

export interface GenerateResult {
  cards: GeneratedCardDraft[]
  promptTokens: number
  completionTokens: number
}

/** Injectable boundary. The generation job depends ONLY on this. */
export interface CardGenerator {
  generate(args: GenerateArgs): Promise<GenerateResult>
}

/** Max output tokens per call (cost/latency bound, non-streaming, < ~16k). */
const MAX_TOKENS = 8192
/** One re-parse attempt if the first output does not validate. */
const MAX_ATTEMPTS = 2
/** Timeout PER API CALL (each attempt gets its own budget). */
const PER_CALL_TIMEOUT_MS = 90_000

/** Real implementation (Anthropic). Client created at call time, not at load. */
export const anthropicGenerator: CardGenerator = {
  async generate({ content, kind, signal }) {
    const client: Anthropic = createAnthropic()
    const instructions = kind === 'quiz' ? QUIZ_INSTRUCTIONS : CARDS_INSTRUCTIONS
    const userText = `${instructions}\n\n--- EXTRAIT DE NOTES ---\n${content}`

    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Fresh signal PER ATTEMPT: 90s of budget for EACH API call, not 90s
      // shared across attempts. Combined with any external signal.
      const timeout = AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
      const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const res = await client.messages.create(
          {
            model: GENERATION_MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            tools: [EMIT_CARDS_TOOL],
            tool_choice: { type: 'tool', name: 'emit_cards' },
            messages: [{ role: 'user', content: userText }],
          },
          { signal: attemptSignal },
        )
        const cards = parseEmitCards(res) // throws if invalid structure OR truncated (max_tokens)
        return {
          cards,
          promptTokens: res.usage.input_tokens,
          completionTokens: res.usage.output_tokens,
        }
      } catch (e) {
        // A validation/truncation error is retried; an abort (timeout/cancel) or
        // a network/API error surfaces after the loop.
        lastErr = e
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('generation: invalid model output')
  },
}

// --- Mutable registry (real injection boundary) ---
let activeGenerator: CardGenerator = anthropicGenerator
export function getCardGenerator(): CardGenerator {
  return activeGenerator
}
/** Test only. */
export function setCardGenerator(g: CardGenerator): void {
  activeGenerator = g
}
/** Test only. */
export function resetCardGenerator(): void {
  activeGenerator = anthropicGenerator
}
