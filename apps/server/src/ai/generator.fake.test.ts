import { describe, expect, it } from 'vitest'
import {
  getCardGenerator,
  anthropicGenerator,
  configuredGenerator,
  resetCardGenerator,
} from './generator'
import { fakeGenerator } from './generator.fake'

/**
 * Guard for the "fake AI never active outside tests" invariant (Phase 7 §1.5).
 * This unit test can only see `generator.ts`'s registry, NOT the env-gated wiring
 * in `index.ts` — that path is covered by the e2e boot guard (`/api/health`
 * `fakeAi`). Here we assert the default registry and the fake's determinism.
 */
describe('card generator registry (fake-AI guard)', () => {
  it('defaults to the configured multi-provider generator when nothing wires the fake', () => {
    resetCardGenerator()
    expect(getCardGenerator()).toBe(configuredGenerator)
    // The fake stays distinct from both real generators.
    expect(fakeGenerator).not.toBe(configuredGenerator)
    expect(fakeGenerator).not.toBe(anthropicGenerator)
  })
})

describe('fakeGenerator', () => {
  it('parses `question :: answer` lines deterministically', async () => {
    const result = await fakeGenerator.generate({
      content: 'Capitale de la France :: Paris\nnot a card line\nH2O :: eau',
      kind: 'cards',
    })
    expect(result.cards).toEqual([
      { front: 'Capitale de la France', back: 'Paris' },
      { front: 'H2O', back: 'eau' },
    ])
    expect(result.promptTokens).toBe(10)
    expect(result.completionTokens).toBe(5)
  })

  it('falls back to a single deterministic card when no line parses', async () => {
    const result = await fakeGenerator.generate({
      content: 'plain prose, no delimiter',
      kind: 'cards',
    })
    expect(result.cards).toHaveLength(1)
  })

  it('throws on the __E2E_FAIL__ sentinel', async () => {
    await expect(
      fakeGenerator.generate({ content: 'boom __E2E_FAIL__ boom', kind: 'cards' }),
    ).rejects.toThrow(/__E2E_FAIL__/)
  })

  it('returns no cards on the __E2E_EMPTY__ sentinel', async () => {
    const result = await fakeGenerator.generate({ content: '__E2E_EMPTY__', kind: 'cards' })
    expect(result.cards).toEqual([])
  })

  it("kind 'mixed' → deterministic UN-expanded mix (2 qa + 1 two-mask cloze)", async () => {
    const result = await fakeGenerator.generate({ content: 'des notes de cours', kind: 'mixed' })
    expect(result.cards).toHaveLength(3)
    expect(result.cards.filter((c) => c.kind === 'qa')).toHaveLength(2)
    const cloze = result.cards.find((c) => c.kind === 'cloze')
    expect(cloze).toBeDefined()
    // The cloze stays a template here — the server expands it into 2 cards.
    expect(cloze && 'clozeText' in cloze ? cloze.clozeText : '').toContain('{{c1::')
  })

  it("kind 'mixed' still honours the __E2E_EMPTY__ sentinel", async () => {
    const result = await fakeGenerator.generate({ content: '__E2E_EMPTY__', kind: 'mixed' })
    expect(result.cards).toEqual([])
  })
})
