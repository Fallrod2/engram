// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { detectSystemLang, LangProvider, useLang, useT } from './index'

/**
 * 29/07/2026 — the interface language follows the system, falls back to English, and
 * never overwrites an explicit choice.
 *
 * Two things are being pinned, and they fail in different ways:
 *
 *   · the DETECTION. A browser reports BCP-47 tags (`fr-CA`, `en-GB`,
 *     `zh-Hant-TW`) and an ordered LIST of them. `navigator.language === 'fr'`
 *     is false for every French-speaking Canadian on earth, which is exactly the
 *     kind of bug that never shows up on the machine it was written on.
 *   · the PRECEDENCE. Like the theme, the provider used to persist on mount, so
 *     every existing user carries a stored language they may never have picked.
 *     That write is gone; a stored value now means a choice, and a choice wins.
 */

function installMockStorage() {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true })
}

function installLanguages(...tags: string[]) {
  Object.defineProperty(window.navigator, 'language', { value: tags[0], configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: tags, configurable: true })
}

function renderLang() {
  return renderHook(() => ({ ...useLang(), t: useT() }), { wrapper: LangProvider })
}

beforeEach(installMockStorage)
afterEach(cleanup)

describe('detectSystemLang — real language tags, not equality on a string', () => {
  it('reads the primary subtag, region and script included', () => {
    installLanguages('fr-CA')
    expect(detectSystemLang()).toBe('fr')
    installLanguages('en-GB')
    expect(detectSystemLang()).toBe('en')
    installLanguages('fr')
    expect(detectSystemLang()).toBe('fr')
  })

  it('walks the preference LIST in order, not just the first entry', () => {
    // A Spaniard who also reads French: nothing in `navigator.language` says so,
    // and the second entry is the only place it is visible.
    installLanguages('es-ES', 'fr-FR', 'en-US')
    expect(detectSystemLang()).toBe('fr')
    installLanguages('de-DE', 'en-GB')
    expect(detectSystemLang()).toBe('en')
  })

  it('falls back to English when we speak none of the listed languages', () => {
    // NOT French: a Spanish or German system shares no language with the FR
    // copy, and English is the one both are far likelier to read (Alex,
    // 29/07/2026).
    installLanguages('es-ES')
    expect(detectSystemLang()).toBe('en')
    installLanguages('zh-Hant-TW', 'ja-JP')
    expect(detectSystemLang()).toBe('en')
  })

  it('accepts the underscore form some WebViews report', () => {
    installLanguages('fr_FR')
    expect(detectSystemLang()).toBe('fr')
  })
})

describe('language — no stored value means no choice', () => {
  it('renders the system language when nothing is stored', () => {
    installLanguages('es-ES')
    const { result } = renderLang()
    expect(result.current.preference).toBe('system')
    expect(result.current.lang).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('writes NOTHING to storage just by mounting', () => {
    installLanguages('fr-FR')
    renderLang()
    expect(localStorage.getItem('engram-lang')).toBeNull()
  })

  it('follows a system language change without a reload', () => {
    installLanguages('fr-FR')
    const { result } = renderLang()
    expect(result.current.lang).toBe('fr')
    act(() => {
      installLanguages('en-US')
      window.dispatchEvent(new Event('languagechange'))
    })
    expect(result.current.lang).toBe('en')
  })
})

describe('language — an explicit choice outranks the system', () => {
  it('keeps a stored language against a different system one', () => {
    installLanguages('en-US')
    localStorage.setItem('engram-lang', 'fr')
    const { result } = renderLang()
    expect(result.current.lang).toBe('fr')
    expect(result.current.t('common.save')).toBe('Enregistrer')
  })

  it('ignores the system entirely once a language is chosen', () => {
    installLanguages('fr-FR')
    localStorage.setItem('engram-lang', 'en')
    const { result } = renderLang()
    act(() => {
      installLanguages('fr-CA')
      window.dispatchEvent(new Event('languagechange'))
    })
    expect(result.current.lang).toBe('en')
  })

  it('persists a choice made from Settings', () => {
    installLanguages('fr-FR')
    const { result } = renderLang()
    act(() => result.current.setLang('en'))
    expect(localStorage.getItem('engram-lang')).toBe('en')
    expect(result.current.lang).toBe('en')
  })

  it('lets the user go back to following the system', () => {
    installLanguages('fr-FR')
    localStorage.setItem('engram-lang', 'en')
    const { result } = renderLang()
    act(() => result.current.setLang('system'))
    expect(localStorage.getItem('engram-lang')).toBe('system')
    expect(result.current.preference).toBe('system')
    expect(result.current.lang).toBe('fr')
  })
})
