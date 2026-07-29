import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * What the user chose — which includes choosing not to choose (29/07/2026).
 * `'system'` is not a language, it is a *policy*: follow the browser/OS list.
 */
export type LangPreference = Lang | 'system'

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
  /** The language actually rendered — `preference`, resolved. */
  lang: Lang
  /** What is stored: a language, or `'system'` (the default). */
  preference: LangPreference
  setLang: (lang: LangPreference) => void
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
  preference: 'fr',
  setLang: () => {},
  t: (key, vars) => interpolate(resolve(dictFr, key), vars),
}

const LangContext = createContext<LangContextValue>(DEFAULT_VALUE)

/**
 * What is stored, if anything. No stored value = no choice = follow the system
 * (29/07/2026).
 *
 * A stored `'fr'`/`'en'` is an explicit choice and outranks the system for good.
 * Users who were here before this change carry one already — the provider used
 * to persist its resolved language on mount, so the first paint wrote a key
 * whether or not anyone had chosen. That write is gone (see `LangProvider`);
 * what it wrote in the past cannot be told apart from a real choice, so it is
 * honoured as one, and « Système » in Settings is the way back.
 */
function readStoredPreference(): LangPreference {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'en' || raw === 'fr' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

/**
 * The system language, mapped onto the two we speak.
 *
 * REAL TAGS, NOT `navigator.language === 'fr'`. What a browser reports is a
 * BCP-47 tag with a region and sometimes a script — `fr-CA`, `en-GB`,
 * `zh-Hant-TW` — and `navigator.languages` is an ORDERED list of them, which is
 * the only place a "French first, English second" user is visible at all. So we
 * walk the list in order and compare PRIMARY SUBTAGS: `fr-CA` is French, and a
 * Quebecker gets the French UI rather than the fallback.
 *
 * Fallback `en` and not `fr` (Alex, 29/07/2026): a Spanish or German system
 * shares no language with FR copy, and English is the one both are far likelier
 * to read. French remains the default of the FR-speaking world by the rule
 * above, not by being the universal fallback.
 */
export function detectSystemLang(): Lang {
  if (typeof navigator === 'undefined') return 'en'
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    // `-` is the standard separator; `_` shows up in the wild (some Android
    // builds, some embedded WebViews) and costs one character to accept.
    const primary = tag?.toLowerCase().split(/[-_]/)[0]
    if (primary === 'fr') return 'fr'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<LangPreference>(readStoredPreference)
  const [systemLang, setSystemLang] = useState<Lang>(detectSystemLang)
  /** The language actually rendered: the preference, resolved. */
  const active: Lang = preference === 'system' ? systemLang : preference

  // The FIRST render has to be localized already, otherwise the pure formatters
  // (relative dates, countdown, month labels) flash `fr-FR` output — they read a
  // module variable, and mutating it in an effect re-renders nothing. Primed
  // during the initial render, exactly as the previous lazy initializer did.
  const primed = useRef(false)
  if (!primed.current) {
    primed.current = true
    setLocale(LOCALES[active])
  }

  // Track the system list so `'system'` stays true after the fact: switching the
  // OS language fires `languagechange` on the window, and the app follows
  // without a reload — same promise as the theme.
  useEffect(() => {
    const onChange = () => setSystemLang(detectSystemLang())
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  }, [])

  // Reflect changes onto `<html lang>` (a11y) and the format.ts locale. NOT
  // persisted here: mounting is not choosing (29/07/2026). Writing on mount is what
  // used to make "never picked a language" and "picked French" the same stored
  // string, and there is no telling them apart afterwards.
  useEffect(() => {
    document.documentElement.lang = active
    setLocale(LOCALES[active])
  }, [active])

  const setLang = useCallback((next: LangPreference) => {
    setPreference(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Rien à faire : le choix s'applique quand même pour cette page.
    }
  }, [])

  const t = useMemo<TFunction>(() => {
    const dict = DICTS[active]
    return (key, vars) => interpolate(resolve(dict, key), vars)
  }, [active])

  const value = useMemo<LangContextValue>(
    () => ({ lang: active, preference, setLang, t }),
    [active, preference, setLang, t],
  )

  return <LangContext value={value}>{children}</LangContext>
}

function useLangContext(): LangContextValue {
  return useContext(LangContext)
}

/** The translator. `t('common.save')`, `t('cmd.actions.reviewSubject', { name })`. */
export function useT(): TFunction {
  return useLangContext().t
}

/**
 * The current language + a setter (spec §9.6, Settings language block).
 *
 * `lang` is what is on screen; `preference` is what was chosen, `'system'`
 * included — the settings screen needs both to say which one is in force.
 */
export function useLang(): {
  lang: Lang
  preference: LangPreference
  setLang: (lang: LangPreference) => void
} {
  const { lang, preference, setLang } = useLangContext()
  return { lang, preference, setLang }
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
