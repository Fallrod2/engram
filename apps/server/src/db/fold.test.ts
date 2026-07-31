import { describe, expect, it } from 'vitest'
import { escapeLike, FOLD_FROM, FOLD_LIGATURES, FOLD_TO } from './fold'

/**
 * Guards on the fold TABLES themselves (the SQL behaviour is exercised against a
 * real database in `card-search.spec.ts`). These two strings are generated from
 * Unicode NFD, and a hand edit that shifts one character would silently fold
 * every letter after it to the wrong base — a corruption no search test would
 * obviously catch, because the results would merely be subtly wrong.
 */
describe('fold tables', () => {
  it('FROM and TO are aligned 1:1', () => {
    const from = [...FOLD_FROM]
    const to = [...FOLD_TO]
    expect(from.length).toBe(to.length)
    // Every code point must be a single UTF-16 unit: `translate` counts
    // characters, so a surrogate pair would desynchronise the two tables.
    expect(FOLD_FROM.length).toBe(from.length)
    expect(FOLD_TO.length).toBe(to.length)
  })

  it('every target is a plain ASCII letter', () => {
    expect([...FOLD_TO].every((ch) => /^[A-Za-z]$/.test(ch))).toBe(true)
  })

  it('no source character is repeated', () => {
    expect(new Set([...FOLD_FROM]).size).toBe(FOLD_FROM.length)
  })

  it('no source character is already ASCII (a fold must never touch A-Z)', () => {
    expect([...FOLD_FROM].some((ch) => ch.codePointAt(0)! < 128)).toBe(false)
  })

  it('agrees with Unicode NFD wherever NFD decomposes', () => {
    const to = [...FOLD_TO]
    for (const [i, ch] of [...FOLD_FROM].entries()) {
      const nfd = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '')
      if (nfd.length === 1 && /^[A-Za-z]$/.test(nfd)) {
        expect(`${ch} -> ${to[i]}`).toBe(`${ch} -> ${nfd}`)
      }
    }
  })

  it('covers the French accented letters', () => {
    for (const ch of 'àâäéèêëîïôöùûüÿçÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇ') {
      expect(FOLD_FROM.includes(ch)).toBe(true)
    }
  })

  it('ligatures expand to two letters and are lowercase (lower() runs first)', () => {
    for (const [from, to] of FOLD_LIGATURES) {
      expect(from).toBe(from.toLowerCase())
      expect(to).toMatch(/^[a-z]{2}$/)
    }
  })
})

describe('escapeLike', () => {
  it('neutralises the LIKE metacharacters', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('escapes the backslash FIRST, so its own escapes are not re-escaped', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b')
    expect(escapeLike('\\%')).toBe('\\\\\\%')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Théorie des langages')).toBe('Théorie des langages')
  })
})
