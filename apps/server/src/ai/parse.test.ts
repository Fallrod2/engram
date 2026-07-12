import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { parseEmitCards } from './parse'

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
  it('valid response → list of {front, back}', () => {
    const res = message([toolUse('emit_cards', { cards: [{ front: 'Q1', back: 'A1' }] })])
    expect(parseEmitCards(res)).toEqual([{ front: 'Q1', back: 'A1' }])
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
