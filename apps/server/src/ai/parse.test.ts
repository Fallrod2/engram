import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { extractJsonEmit, parseEmitCards, parseEmitCardsInput } from './parse'

/** Build a minimal Anthropic.Message with the given content + stop_reason. */
function message(
  content: unknown[],
  stopReason: Anthropic.Message['stop_reason'] = 'tool_use',
): Anthropic.Message {
  return { content, stop_reason: stopReason } as unknown as Anthropic.Message
}

function toolUse(name: string, input: unknown) {
  return { type: 'tool_use', id: 'toolu_1', name, input }
}

describe('parseEmitCards', () => {
  it('valid response → list of drafts (kind defaults to qa)', () => {
    const res = message([toolUse('emit_cards', { cards: [{ front: 'Q1', back: 'A1' }] })])
    // The discriminated union normalises a kind-less v1 card to `qa`.
    expect(parseEmitCards(res)).toEqual([{ kind: 'qa', front: 'Q1', back: 'A1' }])
  })

  it('no tool_use block → throws', () => {
    expect(() => parseEmitCards(message([{ type: 'text', text: 'hi' }]))).toThrow()
  })

  it('wrong tool name → throws', () => {
    expect(() => parseEmitCards(message([toolUse('other', { cards: [] })]))).toThrow()
  })

  it('empty front → ZodError (rejected)', () => {
    const res = message([toolUse('emit_cards', { cards: [{ front: '', back: 'A' }] })])
    expect(() => parseEmitCards(res)).toThrow()
  })

  it('> 24 cards → ZodError (bound)', () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }))
    expect(() => parseEmitCards(message([toolUse('emit_cards', { cards })]))).toThrow()
  })

  it("stop_reason 'max_tokens' → throws (truncation guard)", () => {
    const res = message(
      [toolUse('emit_cards', { cards: [{ front: 'Q1', back: 'A1' }] })],
      'max_tokens',
    )
    expect(() => parseEmitCards(res)).toThrow()
  })
})

describe('parseEmitCardsInput (shared Zod funnel)', () => {
  it('validates a raw emitInput object → cards (kind defaults to qa)', () => {
    expect(parseEmitCardsInput({ cards: [{ front: 'Q', back: 'A' }] })).toEqual([
      { kind: 'qa', front: 'Q', back: 'A' },
    ])
  })

  it('rejects a non-conforming shape', () => {
    expect(() => parseEmitCardsInput({ cards: [{ front: '', back: 'A' }] })).toThrow()
    expect(() => parseEmitCardsInput({ nope: true })).toThrow()
  })
})

describe('parseEmitCardsInput (mixed: qa | cloze discriminated union)', () => {
  it('keeps an explicit qa draft with its contentType', () => {
    expect(
      parseEmitCardsInput({
        cards: [{ kind: 'qa', contentType: 'concept', front: 'Q', back: 'A' }],
      }),
    ).toEqual([{ kind: 'qa', contentType: 'concept', front: 'Q', back: 'A' }])
  })

  it('accepts a cloze draft carrying at least one {{cN::…}} mask', () => {
    expect(
      parseEmitCardsInput({
        cards: [{ kind: 'cloze', contentType: 'definition', clozeText: 'Un {{c1::monoïde}}.' }],
      }),
    ).toEqual([{ kind: 'cloze', contentType: 'definition', clozeText: 'Un {{c1::monoïde}}.' }])
  })

  it('rejects a cloze draft with no mask (mislabelled)', () => {
    expect(() =>
      parseEmitCardsInput({ cards: [{ kind: 'cloze', clozeText: 'pas de trou ici' }] }),
    ).toThrow()
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      parseEmitCardsInput({ cards: [{ kind: 'bogus', front: 'Q', back: 'A' }] }),
    ).toThrow()
  })

  it('accepts a mixed batch (qa + cloze together)', () => {
    const out = parseEmitCardsInput({
      cards: [
        { kind: 'qa', front: 'Q', back: 'A' },
        { kind: 'cloze', clozeText: 'La valeur {{c1::42}}.' },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'qa' })
    expect(out[1]).toMatchObject({ kind: 'cloze' })
  })
})

describe('extractJsonEmit (JSON-mode providers)', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonEmit('{"cards":[{"front":"Q","back":"A"}]}')).toEqual({
      cards: [{ front: 'Q', back: 'A' }],
    })
  })

  it('strips ```json fences', () => {
    expect(extractJsonEmit('```json\n{"cards":[]}\n```')).toEqual({ cards: [] })
  })

  it('extracts the first balanced object embedded in prose', () => {
    const text = 'Voici le résultat : {"cards":[{"front":"Q","back":"A"}]} — voilà.'
    expect(extractJsonEmit(text)).toEqual({ cards: [{ front: 'Q', back: 'A' }] })
  })

  it('is string-aware (braces inside JSON strings do not confuse balancing)', () => {
    expect(extractJsonEmit('{"cards":[{"front":"a { b }","back":"A"}]}')).toEqual({
      cards: [{ front: 'a { b }', back: 'A' }],
    })
  })

  it('throws a clear error when there is no JSON object', () => {
    expect(() => extractJsonEmit('just prose, no json')).toThrow(/no JSON object|structured/i)
    expect(() => extractJsonEmit('')).toThrow()
  })
})
