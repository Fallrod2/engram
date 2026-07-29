import { describe, expect, it } from 'vitest'
import type { QueueNewCards } from '@engram/shared'
import { emptyReason, withheldNote } from './new-card-budget'

const budget = (o: Partial<QueueNewCards> = {}): QueueNewCards => ({
  limit: 20,
  introduced: 0,
  remaining: 20,
  withheld: 0,
  ...o,
})

describe('emptyReason', () => {
  it('is "nothing" when the budget held nothing back — the congratulation is earned', () => {
    expect(emptyReason(budget({ withheld: 0 }))).toEqual({ kind: 'nothing' })
    // Budget fully spent but nothing waiting behind it: still genuinely empty.
    expect(emptyReason(budget({ introduced: 20, remaining: 0, withheld: 0 }))).toEqual({
      kind: 'nothing',
    })
  })

  it('degrades to "nothing" when the server sent no budget at all', () => {
    // Older serverless function mid-rollout: with no information, say nothing
    // about the budget rather than invent a withheld count.
    expect(emptyReason(undefined)).toEqual({ kind: 'nothing' })
  })

  it('is "limit" when cards are held back by a spent budget', () => {
    expect(emptyReason(budget({ limit: 20, introduced: 20, remaining: 0, withheld: 7 }))).toEqual({
      kind: 'limit',
      withheld: 7,
      limit: 20,
      introduced: 20,
    })
  })

  it('is "paused" — not "limit" — when the user set the limit to 0', () => {
    // A deliberate pause is a different statement from a limit that was hit.
    expect(emptyReason(budget({ limit: 0, introduced: 0, remaining: 0, withheld: 4 }))).toEqual({
      kind: 'paused',
      withheld: 4,
    })
  })
})

describe('withheldNote', () => {
  it('is null whenever there is nothing to say (the common case)', () => {
    expect(withheldNote(undefined)).toBeNull()
    expect(withheldNote(budget({ withheld: 0 }))).toBeNull()
  })

  it('reports the count and the limit when cards were held back', () => {
    expect(withheldNote(budget({ limit: 20, introduced: 20, remaining: 0, withheld: 3 }))).toEqual({
      withheld: 3,
      limit: 20,
      paused: false,
    })
  })

  it('flags the paused case so the copy can differ', () => {
    expect(withheldNote(budget({ limit: 0, remaining: 0, withheld: 3 }))).toEqual({
      withheld: 3,
      limit: 0,
      paused: true,
    })
  })
})
