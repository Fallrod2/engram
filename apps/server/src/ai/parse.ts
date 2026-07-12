import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'

const emitCardsInputSchema = z.object({
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
 * Extract the `emit_cards` tool_use block from an Anthropic response and validate
 * its input. Throws if: output was truncated (stop_reason max_tokens), no tool
 * block is present, the tool name is wrong, or the input is non-conforming.
 */
export function parseEmitCards(res: Anthropic.Message): { front: string; back: string }[] {
  // Truncation guard: if the model was cut at max_tokens, the tool JSON may be
  // partial/invalid. Throw explicitly to trigger the retry (§2.4) rather than
  // letting a lucky parse slip through.
  if (res.stop_reason === 'max_tokens') {
    throw new Error('generation: model output truncated (max_tokens) — reduce chunk size')
  }
  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_cards',
  )
  if (!block) throw new Error('generation: no emit_cards tool_use block in response')
  // block.input is already an object (parsed by the SDK) — validate it.
  return emitCardsInputSchema.parse(block.input).cards
}
