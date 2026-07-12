import { describe, expect, it } from 'vitest'
import {
  CONTEXT_KEYS,
  CONTEXT_LABELS,
  GLOBAL_KEYS,
  NAV_CHORDS,
  NAV_KEYS,
  chordDisplay,
  contextForPathname,
  navChordFor,
  type ContextId,
} from './keymap'

const KNOWN_ROUTES = ['/', '/review', '/subjects', '/planning', '/analytics', '/import']

describe('nav chords', () => {
  it('has distinct single-letter second keys, none of them "g"', () => {
    const keys = NAV_CHORDS.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) {
      expect(k).toMatch(/^[a-z]$/)
      expect(k).not.toBe('g')
    }
  })

  it('maps every chord to a known route', () => {
    for (const c of NAV_CHORDS) expect(KNOWN_ROUTES).toContain(c.to)
  })

  it('renders and resolves display forms consistently', () => {
    expect(chordDisplay('d')).toBe('G D')
    expect(navChordFor('/')).toBe('G D')
    expect(navChordFor('/subjects')).toBe('G S')
    expect(navChordFor('/settings')).toBeUndefined()
  })

  it('mirrors NAV_CHORDS in NAV_KEYS', () => {
    expect(NAV_KEYS).toHaveLength(NAV_CHORDS.length)
    for (const c of NAV_CHORDS) {
      expect(NAV_KEYS.some((k) => k.keys === chordDisplay(c.key) && k.group === 'nav')).toBe(true)
    }
  })
})

describe('chords ⊥ screen single-keys (spec §3.7.6)', () => {
  it('no global bare single-key ("?" or "[") is reused as a screen hotkey', () => {
    // The only global bare keys are `?` and `[`; chords are prefixed by `g`, so
    // they cannot shadow a local single-key. Prove the bare globals stay free.
    const globalBare = GLOBAL_KEYS.map((g) => g.keys).filter((k) => k.length === 1)
    expect(globalBare).toEqual(expect.arrayContaining(['?', '[']))
    const localSingleKeys = Object.values(CONTEXT_KEYS)
      .flat()
      .map((b) => b.keys)
      .filter((k) => k.length === 1)
    for (const bare of globalBare) expect(localSingleKeys).not.toContain(bare)
  })
})

describe('context coverage', () => {
  it('every context id has at least one binding and a label', () => {
    for (const id of Object.keys(CONTEXT_KEYS) as ContextId[]) {
      expect(CONTEXT_KEYS[id].length).toBeGreaterThan(0)
      expect(CONTEXT_LABELS[id]).toBeTruthy()
    }
  })
})

describe('contextForPathname', () => {
  it.each([
    ['/review', 'session'],
    ['/subjects', 'subjects.index'],
    ['/subjects/abc', 'subjects.detail'],
    ['/subjects/abc/decks/def', 'deck.cards'],
    ['/import', 'import.index'],
    ['/import/note1', 'import.note'],
    ['/import/note1/generations/gen1', 'import.generation'],
    ['/planning', 'planning'],
  ] as const)('resolves %s → %s', (pathname, expected) => {
    expect(contextForPathname(pathname)).toBe(expected)
  })

  it('returns null for screens without a documented context', () => {
    expect(contextForPathname('/analytics')).toBeNull()
    expect(contextForPathname('/settings')).toBeNull()
    expect(contextForPathname('/')).toBeNull()
  })
})
