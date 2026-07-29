import { describe, expect, it } from 'vitest'
import { dictEn } from '@/lib/i18n/dict.en'
import { dictFr } from '@/lib/i18n/dict.fr'
import type { Lang, PluralCategory, TFunction } from '@/lib/i18n'
import { dayCellLabel } from './day-cell-label'

/**
 * The month and week cells announced `"${day} — ${n} reviews prévues, ${m}
 * examens"` — hardcoded French with hand-rolled plurals, so an English UI read
 * an English date followed by French counts. These cases pin the composed
 * sentence in BOTH languages, and the plural rule at the boundaries (FR keeps 0
 * singular, EN does not).
 */

const LOCALES: Record<Lang, string> = { fr: 'fr-FR', en: 'en-US' }

/** The real dictionaries + the real CLDR rule, without mounting React. */
function harness(lang: Lang): { t: TFunction; plural: (n: number) => PluralCategory } {
  const dict = lang === 'fr' ? dictFr : dictEn
  const rules = new Intl.PluralRules(LOCALES[lang])
  const t: TFunction = (key, vars) => {
    const raw = key
      .split('.')
      .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], dict)
    const template = typeof raw === 'string' ? raw : key
    return vars
      ? template.replace(/\{(\w+)\}/g, (_, name: string) =>
          name in vars ? String(vars[name]) : `{${name}}`,
        )
      : template
  }
  return { t, plural: (n) => (rules.select(n) === 'one' ? 'one' : 'other') }
}

describe('dayCellLabel', () => {
  it('composes the French sentence, 0 and 1 singular', () => {
    const { t, plural } = harness('fr')
    expect(dayCellLabel(t, plural, 'lun. 29 juin 2026', 0, 0)).toBe(
      'lun. 29 juin 2026 — 0 review prévue, 0 examen',
    )
    expect(dayCellLabel(t, plural, 'lun. 29 juin 2026', 1, 1)).toBe(
      'lun. 29 juin 2026 — 1 review prévue, 1 examen',
    )
    expect(dayCellLabel(t, plural, 'lun. 29 juin 2026', 12, 2)).toBe(
      'lun. 29 juin 2026 — 12 reviews prévues, 2 examens',
    )
  })

  it('composes the English sentence, with a PLURAL zero', () => {
    const { t, plural } = harness('en')
    expect(dayCellLabel(t, plural, 'Mon, Jun 29, 2026', 0, 0)).toBe(
      'Mon, Jun 29, 2026 — 0 reviews scheduled, 0 exams',
    )
    expect(dayCellLabel(t, plural, 'Mon, Jun 29, 2026', 1, 1)).toBe(
      'Mon, Jun 29, 2026 — 1 review scheduled, 1 exam',
    )
    expect(dayCellLabel(t, plural, 'Mon, Jun 29, 2026', 12, 2)).toBe(
      'Mon, Jun 29, 2026 — 12 reviews scheduled, 2 exams',
    )
  })

  it('leaves no French in the English sentence', () => {
    const { t, plural } = harness('en')
    expect(dayCellLabel(t, plural, 'Mon, Jun 29, 2026', 3, 1)).not.toMatch(/prévu|examen/)
  })
})
