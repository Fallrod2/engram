import { describe, expect, it } from 'vitest'
import { defaultFilter } from 'cmdk'
import { CARD_SCORE, MATCH_FLOOR, cardItemValue, paletteFilter } from './command-filter'

/**
 * What this guards, in one sentence: the palette gained a second kind of row,
 * and neither kind may damage the other.
 */
describe('paletteFilter', () => {
  it('never hides a card row, whatever was typed', () => {
    // The server matched it — accent- and case-insensitively, over the BACK of
    // the card, which the palette never sees. Re-scoring it here is exactly how
    // "⌘K says no results for a card that exists" comes back.
    const value = cardItemValue('card-1')
    expect(paletteFilter(value, 'kleene')).toBeGreaterThan(0)
    expect(paletteFilter(value, 'zzzzz')).toBeGreaterThan(0)
    expect(paletteFilter(value, 'théorie')).toBeGreaterThan(0)
  })

  it('gives every card row the SAME score, so the server ordering survives', () => {
    // Array#sort is stable, so equal scores preserve DOM order — which is the
    // order the service promises (front-matches first, then oldest).
    const scores = ['a', 'b', 'c'].map((id) => paletteFilter(cardItemValue(id), 'kleene'))
    expect(new Set(scores).size).toBe(1)
  })

  it('keeps cmdk scoring for ordinary actions', () => {
    const exact = paletteFilter('Planning planning calendrier', 'planning')
    const loose = paletteFilter('Réglages settings options', 'planning')
    expect(exact).toBeGreaterThan(loose)
  })

  it('hides a non-card row cmdk does not match at all', () => {
    expect(paletteFilter('Planning planning calendrier', 'zzzzz')).toBe(0)
  })

  it('ranks EVERY real match above EVERY card row — the actions never move', () => {
    // The floor is the load-bearing part, and the case it guards is real, not
    // theoretical: `command-score` multiplies a 0.17 factor per character jump,
    // so a deep gappy match scores 5.8e-10 here — four orders of magnitude
    // BELOW a card row. Without the floor that match would drag the Cards group
    // above Navigation, 200 ms after the user already saw their actions.
    const gappy = 'zazbzczdzezfzgzhzizjzkzl'
    const raw = defaultFilter(gappy, 'abcdefghijkl')
    expect(raw).toBeGreaterThan(0)
    expect(raw).toBeLessThan(CARD_SCORE)
    expect(paletteFilter(gappy, 'abcdefghijkl')).toBeGreaterThan(CARD_SCORE)
    expect(paletteFilter(gappy, 'abcdefghijkl')).toBe(MATCH_FLOOR)
  })

  it('does not promote a non-match to the floor', () => {
    expect(paletteFilter('nothing alike', 'qqqq')).toBe(0)
  })
})

describe('cardItemValue', () => {
  it('is opaque and unique per card, never the visible text', () => {
    // A cmdk value built from the card's front would change as the user edits
    // the card, and cmdk requires a stable value for a stable row.
    expect(cardItemValue('abc')).not.toContain(' ')
    expect(cardItemValue('abc')).not.toBe(cardItemValue('abd'))
  })
})
