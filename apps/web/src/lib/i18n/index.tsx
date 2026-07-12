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

function readStoredLang(): Lang {
  if (typeof localStorage === 'undefined') return 'fr'
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'en' ? 'en' : 'fr'
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang)

  // Reflect the language onto `<html lang>` (a11y) and the format.ts locale, and
  // persist it. `setLocale` runs synchronously so the first render is localized.
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
