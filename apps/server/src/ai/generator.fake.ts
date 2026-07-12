import type { CardGenerator, GenerateArgs, GenerateResult } from './generator'

/**
 * Test-only deterministic card generator (Phase 7 §1.5). Wired into the server
 * ONLY when `ENGRAM_FAKE_AI=1` (see `index.ts`), so the real Anthropic API is
 * never called during the e2e suite.
 *
 * Belt-and-suspenders safety: this module imports NOTHING from
 * `@anthropic-ai/sdk` and has no network access — even if it were loaded outside
 * a test, it could not reach Anthropic. The env-gated wiring in `index.ts`
 * remains the single activation path.
 */

/** Short latency so the UI's `pending` polling state is observable in e2e. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const fakeGenerator: CardGenerator = {
  async generate({ content }: GenerateArgs): Promise<GenerateResult> {
    await sleep(40)

    // Sentinels drive the error/empty paths without any API dependency.
    if (content.includes('__E2E_FAIL__')) {
      throw new Error('fake generation failure (__E2E_FAIL__)')
    }
    if (content.includes('__E2E_EMPTY__')) {
      return { cards: [], promptTokens: 1, completionTokens: 1 }
    }

    // Deterministic parse: every `question :: answer` line becomes one card.
    const cards = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('::'))
      .map((line) => {
        const idx = line.indexOf('::')
        return { front: line.slice(0, idx).trim(), back: line.slice(idx + 2).trim() }
      })
      .filter((c) => c.front.length > 0 && c.back.length > 0)

    const final = cards.length > 0 ? cards : [{ front: 'Carte factice', back: 'Réponse factice' }]
    return { cards: final, promptTokens: 10, completionTokens: 5 }
  },
}
