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
  async generate({ content, kind }: GenerateArgs): Promise<GenerateResult> {
    await sleep(40)

    // Sentinels drive the error/empty paths without any API dependency. They
    // stay BEFORE the kind branch so every mode can exercise them.
    if (content.includes('__E2E_FAIL__')) {
      throw new Error('fake generation failure (__E2E_FAIL__)')
    }
    if (content.includes('__E2E_EMPTY__')) {
      return { cards: [], promptTokens: 1, completionTokens: 1 }
    }

    // Mixed mode: emit a deterministic, UN-expanded mix (2 qa + 1 cloze with two
    // masks). The server's real expansion path (ai/cloze.ts) then materialises
    // the cloze into 2 cards → 4 items total, so the e2e exercises expansion for
    // real rather than a pre-baked result.
    if (kind === 'mixed') {
      return {
        cards: [
          {
            kind: 'qa',
            contentType: 'concept',
            front: 'Pourquoi réviser ?',
            back: 'Pour retenir.',
          },
          {
            kind: 'qa',
            contentType: 'concept',
            front: 'Comment fonctionne la répétition espacée ?',
            back: 'En espaçant les révisions.',
          },
          {
            kind: 'cloze',
            contentType: 'definition',
            clozeText: 'Un {{c1::monoïde}} possède un élément {{c2::neutre}}.',
          },
        ],
        promptTokens: 10,
        completionTokens: 5,
      }
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
