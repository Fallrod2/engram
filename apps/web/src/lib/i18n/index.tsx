import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setLocale } from '@/lib/format'
import { dictFr, type Dict } from './dict.fr'
import { dictEn } from './dict.en'

/**
 * Home-grown, typed i18n (spec §9.2). Rejected `i18next`/`lingui` as too heavy
 * for a single-user localhost tool. `dict.fr.ts` is the source of truth; the key
 * type is derived from it, so `t('a.b.c')` autocompletes and typos fail the
 * build. Default `fr`; switching re-renders (no reload); `<html lang>` and the
 * `format.ts` locale follow.
 */
export type Lang = 'fr' | 'en'

const STORAGE_KEY = 'engram-lang'
const DICTS: Record<Lang, Dict> = { fr: dictFr, en: dictEn }
const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' }

/** Dot-paths to string leaves of the dictionary (e.g. `'dashboard.streak.label'`). */
type Leaves<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`
    }[keyof T & string]

export type TKey = Leaves<Dict>
export type Vars = Record<string, string | number>
export type TFunction = (key: TKey, vars?: Vars) => string

function resolve(dict: Dict, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], dict)
  // A missing key never crashes the UI; it renders its path (visible in dev).
  return typeof value === 'string' ? value : key
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  )
}

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunction
}

/**
 * Default context when no `<LangProvider>` is mounted: the FR dictionary, a
 * no-op setter. This keeps `useT` from throwing in provider-free unit tests
 * (components render with the default `fr` strings) while the real app always
 * mounts the provider in `main.tsx`.
 */
const DEFAULT_VALUE: LangContextValue = {
  lang: 'fr',
  setLang: () => {},
  t: (key, vars) => interpolate(resolve(dictFr, key), vars),
}

const LangContext = createContext<LangContextValue>(DEFAULT_VALUE)

/**
 * Initial language: an explicit stored choice wins; otherwise we fall back to the
 * browser's preferred language so an English-speaking visitor (e.g. arriving from
 * GitHub) lands on the EN copy without hunting for a toggle. Default `fr`
 * otherwise (the project's primary EPITA audience). Only the first, un-persisted
 * paint consults the navigator — once the user picks a language it is stored and
 * takes precedence forever.
 */
function readStoredLang(): Lang {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'en' || raw === 'fr') return raw
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const l of langs) {
      const primary = l?.toLowerCase().split('-')[0]
      if (primary === 'fr') return 'fr'
      if (primary === 'en') return 'en'
    }
  }
  return 'fr'
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  // Lazy init also primes the format.ts locale so the FIRST render is already
  // localized — otherwise the pure formatters (relative dates, countdown, month
  // labels) would flash `fr-FR` output when `engram-lang=en` is persisted, since
  // the module-variable mutation below doesn't itself trigger a re-render.
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = readStoredLang()
    setLocale(LOCALES[initial])
    return initial
  })

  // Reflect subsequent changes onto `<html lang>` (a11y) and the format.ts
  // locale, and persist. (The very first paint is handled by the lazy init.)
  useEffect(() => {
    document.documentElement.lang = lang
    setLocale(LOCALES[lang])
    localStorage.setItem(STORAGE_KEY, lang)
  }, [lang])

  const setLang = useCallback((next: Lang) => setLangState(next), [])

  const t = useMemo<TFunction>(() => {
    const dict = DICTS[lang]
    return (key, vars) => interpolate(resolve(dict, key), vars)
  }, [lang])

  const value = useMemo<LangContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <LangContext value={value}>{children}</LangContext>
}

function useLangContext(): LangContextValue {
  return useContext(LangContext)
}

/** The translator. `t('common.save')`, `t('cmd.actions.reviewSubject', { name })`. */
export function useT(): TFunction {
  return useLangContext().t
}

/** The current language + a setter (spec §9.6, Settings language block). */
export function useLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const { lang, setLang } = useLangContext()
  return { lang, setLang }
}

/** The two plural forms our dictionaries carry (`{key}_one` / `{key}_other`). */
export type PluralCategory = 'one' | 'other'

/**
 * Locale-correct plural selector (spec §9.2). Returns the `_one`/`_other` suffix
 * for a count under the active locale's CLDR rules via `Intl.PluralRules`:
 * English → `one` only for exactly 1 (so `0 reviews`, `2 reviews`); French →
 * `one` for 0 and 1 (`0 jour`, `1 jour`), `other` from 2. A bare `count === 1`
 * would be wrong for FR at 0, and `count > 1` wrong for EN at 0.
 */
export function usePlural(): (count: number) => PluralCategory {
  const { lang } = useLangContext()
  return useMemo(() => {
    const rules = new Intl.PluralRules(LOCALES[lang])
    return (count: number) => (rules.select(count) === 'one' ? 'one' : 'other')
  }, [lang])
}
