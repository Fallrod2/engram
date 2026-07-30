import { describe, expect, it } from 'vitest'
import { CARD_BULK_MAX } from '@engram/shared'
import {
  EMPTY_SELECTION,
  SELECTION_MAX,
  extendTo,
  forget,
  isPageFullySelected,
  isPagePartiallySelected,
  isSelected,
  toggleOne,
  togglePage,
  type Selection,
} from './selection'

const PAGE = ['a', 'b', 'c', 'd', 'e']

function sel(ids: string[], anchor: string | null = null): Selection {
  return { ids, anchor }
}

describe('toggleOne', () => {
  it('adds a row and makes it the anchor', () => {
    const { selection } = toggleOne(EMPTY_SELECTION, 'b')
    expect(selection).toEqual({ ids: ['b'], anchor: 'b' })
  })

  it('removes a selected row, and still moves the anchor to it', () => {
    // The anchor follows the last row the user TOUCHED, selected or not: a
    // Shift range started right after a deselect must run from there.
    const { selection } = toggleOne(sel(['a', 'b'], 'a'), 'b')
    expect(selection).toEqual({ ids: ['a'], anchor: 'b' })
  })

  it('keeps insertion order, which is what makes the cap predictable', () => {
    let s = EMPTY_SELECTION
    for (const id of ['c', 'a', 'e']) s = toggleOne(s, id).selection
    expect(s.ids).toEqual(['c', 'a', 'e'])
  })
})

describe('extendTo — Shift+click / Shift+arrow', () => {
  it('selects the whole interval between the anchor and the row, inclusive', () => {
    const { selection } = extendTo(sel(['b'], 'b'), PAGE, 'd')
    expect(selection.ids).toEqual(['b', 'c', 'd'])
  })

  it('works upwards as well as downwards', () => {
    const { selection } = extendTo(sel(['d'], 'd'), PAGE, 'b')
    expect(selection.ids).toEqual(['d', 'b', 'c'])
    expect(new Set(selection.ids)).toEqual(new Set(['b', 'c', 'd']))
  })

  it('is ADDITIVE: a second range does not undo the first', () => {
    const first = extendTo(sel(['a'], 'a'), PAGE, 'b').selection
    const second = toggleOne(first, 'd').selection
    const third = extendTo(second, PAGE, 'e').selection
    expect(new Set(third.ids)).toEqual(new Set(['a', 'b', 'd', 'e']))
  })

  it('leaves the anchor put, so growing the range one row further grows it', () => {
    const one = extendTo(sel(['b'], 'b'), PAGE, 'c').selection
    expect(one.anchor).toBe('b')
    const two = extendTo(one, PAGE, 'd').selection
    expect(two.ids).toEqual(['b', 'c', 'd'])
  })

  it('degrades to a plain toggle when the anchor is not on this page', () => {
    // The anchor was picked before paging; there is no visible interval to span.
    const { selection } = extendTo(sel(['zz'], 'zz'), PAGE, 'c')
    expect(selection).toEqual({ ids: ['zz', 'c'], anchor: 'c' })
  })

  it('degrades to a plain toggle with no anchor at all', () => {
    expect(extendTo(EMPTY_SELECTION, PAGE, 'c').selection).toEqual({ ids: ['c'], anchor: 'c' })
  })

  it('ignores a row that is not on the page', () => {
    const before = sel(['a'], 'a')
    expect(extendTo(before, PAGE, 'zz').selection).toBe(before)
  })
})

describe('togglePage — the header checkbox', () => {
  it('selects every row of the page', () => {
    expect(togglePage(EMPTY_SELECTION, PAGE).selection.ids).toEqual(PAGE)
  })

  it('releases exactly this page and keeps rows picked elsewhere', () => {
    const s = sel(['zz', ...PAGE])
    expect(togglePage(s, PAGE).selection.ids).toEqual(['zz'])
  })

  it('completes a partial page rather than clearing it', () => {
    const s = sel(['b', 'd'], 'd')
    expect(new Set(togglePage(s, PAGE).selection.ids)).toEqual(new Set(PAGE))
  })

  it('does nothing on an empty page', () => {
    const s = sel(['a'])
    expect(togglePage(s, []).selection).toBe(s)
  })
})

describe('page state predicates', () => {
  it('tells "all", "some" and "none" apart', () => {
    expect(isPageFullySelected(sel(PAGE), PAGE)).toBe(true)
    expect(isPagePartiallySelected(sel(PAGE), PAGE)).toBe(false)
    expect(isPagePartiallySelected(sel(['b']), PAGE)).toBe(true)
    expect(isPageFullySelected(EMPTY_SELECTION, PAGE)).toBe(false)
    expect(isPagePartiallySelected(EMPTY_SELECTION, PAGE)).toBe(false)
  })

  it('an empty page is never "fully selected"', () => {
    expect(isPageFullySelected(sel(['a']), [])).toBe(false)
  })
})

/**
 * The batch ceiling. It is mirrored from the server so the user learns about it
 * while selecting — not after clicking Delete on a batch the server will 400.
 */
describe('the batch cap', () => {
  it('mirrors the shared contract', () => {
    expect(SELECTION_MAX).toBe(CARD_BULK_MAX)
  })

  it('refuses the overflow and reports exactly how many it refused', () => {
    const full = sel(Array.from({ length: SELECTION_MAX }, (_, i) => `id${i}`))
    const page = ['x1', 'x2', 'x3']
    const result = togglePage(full, page)
    expect(result.selection.ids).toHaveLength(SELECTION_MAX)
    expect(result.rejected).toBe(3)
    expect(isSelected(result.selection, 'x1')).toBe(false)
  })

  it('fills the last free slots before refusing the rest', () => {
    const nearly = sel(Array.from({ length: SELECTION_MAX - 2 }, (_, i) => `id${i}`))
    const result = togglePage(nearly, ['x1', 'x2', 'x3', 'x4'])
    expect(result.selection.ids).toHaveLength(SELECTION_MAX)
    expect(result.rejected).toBe(2)
    expect(isSelected(result.selection, 'x1')).toBe(true)
    expect(isSelected(result.selection, 'x2')).toBe(true)
    expect(isSelected(result.selection, 'x3')).toBe(false)
  })

  it('does not count an already-selected id as refused', () => {
    const full = sel(Array.from({ length: SELECTION_MAX }, (_, i) => `id${i}`))
    expect(togglePage(full, ['id0', 'id1']).rejected).toBe(0)
  })

  it('reports nothing refused on a normal selection', () => {
    expect(togglePage(EMPTY_SELECTION, PAGE).rejected).toBe(0)
    expect(toggleOne(EMPTY_SELECTION, 'a').rejected).toBe(0)
  })
})

describe('forget — after a successful bulk delete', () => {
  it('drops the deleted ids and the anchor if it was one of them', () => {
    expect(forget(sel(['a', 'b', 'c'], 'b'), ['b', 'c'])).toEqual({ ids: ['a'], anchor: null })
  })

  it('keeps an anchor that survived', () => {
    expect(forget(sel(['a', 'b'], 'a'), ['b'])).toEqual({ ids: ['a'], anchor: 'a' })
  })
})
