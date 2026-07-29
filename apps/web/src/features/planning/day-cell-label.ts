import type { PluralCategory, TFunction } from '@/lib/i18n'

/**
 * Accessible name (and hover tooltip) of a calendar day cell, month AND week.
 *
 * Both views built this sentence inline, in hardcoded French with hand-rolled
 * plurals: `${day} — ${total} reviews prévues, ${exams.length} examens`. In an
 * English UI a screen reader read out an English date followed by French counts,
 * and the FR wording itself was wrong at zero and one. Composed here, once, so
 * the two views cannot drift apart again — same shape as `dueRowLabel` for the
 * sidebar rows.
 *
 *   "lun. 29 juin 2026 — 1 review prévue, 0 examen"
 *   "Mon, Jun 29, 2026 — 1 review scheduled, 0 exams"
 *
 * The review half reuses `planning.dayLoad_*`, the very phrase `<DayLoad>`
 * announces inside the cell, so the cell and its meter say the same thing.
 */
export function dayCellLabel(
  t: TFunction,
  plural: (count: number) => PluralCategory,
  day: string,
  reviewCount: number,
  examCount: number,
): string {
  return t('planning.dayCellAria', {
    day,
    load: t(`planning.dayLoad_${plural(reviewCount)}`, { count: reviewCount }),
    exams: t(`planning.exams_${plural(examCount)}`, { count: examCount }),
  })
}
