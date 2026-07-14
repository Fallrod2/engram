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
import {
  MIXED_INSTRUCTIONS,
  EMIT_MIXED_CARDS_DESCRIPTION,
  EMIT_MIXED_CARDS_JSON_SCHEMA,
  EMIT_MIXED_CARDS_TOOL,
} from './prompts/cards.v2'
import { parseEmitCards, parseEmitCardsInput, type GeneratedCardDraft } from './parse'
import { PROVIDERS } from './providers'
import { MAX_OUTPUT_TOKENS } from './providers/constants'
import type { EmitSpec, ProviderAdapter, ResolvedProviderConfig } from './providers/types'

export type { GeneratedCardDraft }

/** The v2 (qa|cloze) structured-output contract, used ONLY for the mixed kind. */
const MIXED_EMIT: EmitSpec = {
  description: EMIT_MIXED_CARDS_DESCRIPTION,
  schema: EMIT_MIXED_CARDS_JSON_SCHEMA,
  tool: EMIT_MIXED_CARDS_TOOL,
}

/** Kind → the instruction block appended to the user message. */
function instructionsFor(kind: GenerationKind): string {
  if (kind === 'quiz') return QUIZ_INSTRUCTIONS
  if (kind === 'mixed') return MIXED_INSTRUCTIONS
  return CARDS_INSTRUCTIONS
}

export interface GenerateArgs {
  /** Text of the extract (one chunk). */
  content: string
  kind: GenerationKind
  /** Optional external cancellation signal (combined with the internal timeout). */
  signal?: AbortSignal
  /**
   * Resolved provider config. Provided by the job (resolved ONCE in the router);
   * absent only for direct calls, where the configured generator re-resolves it.
   */
  provider?: ResolvedProviderConfig
  /**
   * Owner id for the rare direct-call re-resolve path (spec BYOK §1.3): the AI
   * config is per-user, so a resolution WITHOUT an explicit identity is refused
   * rather than silently reaching for an unscoped/admin config. Ignored when
   * `provider` is already supplied (the nominal job path).
   */
  userId?: string
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

/** One re-parse attempt if the first output does not validate. */
const MAX_ATTEMPTS = 2
/** Timeout PER API CALL (each attempt gets its own budget). */
const PER_CALL_TIMEOUT_MS = 90_000

/**
 * Provider-agnostic orchestration: the attempt loop, the per-attempt timeout
 * signal, and the single Zod parse funnel. Each adapter only does ONE model call
 * per attempt. Exported so the loop can be unit-tested with a fake adapter.
 */
export async function runProviderGeneration(
  adapter: ProviderAdapter,
  cfg: ResolvedProviderConfig,
  args: { content: string; kind: GenerationKind; signal?: AbortSignal },
): Promise<GenerateResult> {
  const instructions = instructionsFor(args.kind)
  const userText = `${instructions}\n\n--- EXTRAIT DE NOTES ---\n${args.content}`
  // Only the mixed kind switches the wire schema to v2 (qa|cloze); cards/quiz
  // leave `emit` undefined → the adapters keep their byte-identical v1 wire.
  const emit = args.kind === 'mixed' ? MIXED_EMIT : undefined

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh signal PER ATTEMPT: 90s of budget for EACH model call.
    const timeout = AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
    const attemptSignal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout
    try {
      const res = await adapter.complete(cfg, {
        system: SYSTEM_PROMPT,
        userText,
        signal: attemptSignal,
        attempt,
        ...(emit ? { emit } : {}),
      })
      const cards = parseEmitCardsInput(res.emitInput) // the ONLY Zod validation
      return {
        cards,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('generation: invalid model output')
}

/**
 * The new DEFAULT generator: resolves the active provider and delegates to the
 * matching adapter through the shared orchestration. In prod `args.provider` is
 * always supplied (resolved once in the router); a direct call re-resolves it.
 */
export const configuredGenerator: CardGenerator = {
  async generate(args) {
    let cfg = args.provider
    if (!cfg) {
      // Rare direct-call path: re-resolve against the live DB (lazy import keeps
      // this module free of a hard `db` dependency for the nominal flow). The
      // per-user config REQUIRES an explicit identity — no resolution without one.
      if (!args.userId) {
        throw new Error('AI generation: a userId is required to resolve the provider config')
      }
      const { db } = await import('../db/client')
      const { resolveActiveProvider } = await import('../services/ai-config.service')
      cfg = (await resolveActiveProvider(db, args.userId)) ?? undefined
    }
    if (!cfg) throw new Error('AI generation unavailable: no provider configured')
    const adapter = PROVIDERS[cfg.providerId]
    return runProviderGeneration(adapter, cfg, {
      content: args.content,
      kind: args.kind,
      ...(args.signal ? { signal: args.signal } : {}),
    })
  },
}

/**
 * Legacy single-provider Anthropic generator. No longer the default (the
 * configured multi-provider generator is), but KEPT and exported: it is the
 * distinctness anchor for the fake-AI guard test and a direct Anthropic path.
 */
export const anthropicGenerator: CardGenerator = {
  async generate({ content, kind, signal }) {
    const client: Anthropic = createAnthropic()
    const instructions = instructionsFor(kind)
    const userText = `${instructions}\n\n--- EXTRAIT DE NOTES ---\n${content}`
    // Mixed forces the v2 tool; cards/quiz keep the v1 tool (unchanged).
    const tool = kind === 'mixed' ? EMIT_MIXED_CARDS_TOOL : EMIT_CARDS_TOOL

    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const timeout = AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
      const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const res = await client.messages.create(
          {
            model: GENERATION_MODEL,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: SYSTEM_PROMPT,
            tools: [tool],
            tool_choice: { type: 'tool', name: 'emit_cards' },
            messages: [{ role: 'user', content: userText }],
          },
          { signal: attemptSignal },
        )
        const cards = parseEmitCards(res)
        return {
          cards,
          promptTokens: res.usage.input_tokens,
          completionTokens: res.usage.output_tokens,
        }
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('generation: invalid model output')
  },
}

// --- Mutable registry (real injection boundary; API unchanged, default swapped) ---
let activeGenerator: CardGenerator = configuredGenerator
export function getCardGenerator(): CardGenerator {
  return activeGenerator
}
/** Test only. */
export function setCardGenerator(g: CardGenerator): void {
  activeGenerator = g
}
/** Test only. */
export function resetCardGenerator(): void {
  activeGenerator = configuredGenerator
}
