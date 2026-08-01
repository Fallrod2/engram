import type { PluralCategory, TFunction } from '@/lib/i18n'

/** The two halves a nav row announces; the total is always their sum (T-013). */
export interface DueRowCounts {
  overdueCount: number
  todayCount: number
}

/**
 * What a row knows about its counts. `undefined` is "not back yet"; `'unknown'`
 * is "the read failed and will not come back on its own" (T-066). They render
 * differently — a shimmer against an em-dash — and they announce differently,
 * which is the whole reason they are two values and not one.
 */
export type DueRowState = DueRowCounts | 'unknown' | undefined

/**
 * Accessible name of a sidebar nav row that carries a due count (T-017).
 *
 * The rail used to be a dead end for a screen reader: collapsed, the badge was
 * `aria-hidden`, the digits were truncated to `9+`, and the tooltip repeated the
 * label. This builds ONE sentence, used verbatim as the row's `aria-label` in
 * BOTH states, so the exact figures are always available — never `9+`, never
 * silence, and never a different wording depending on how wide the rail is.
 *
 *   "Théorie des langages, 12 cartes en retard, 5 pour aujourd'hui"
 *   "Théorie des langages, 12 cards overdue, 5 due today"
 *
 * A zero half is omitted rather than announced ("0 en retard" on every healthy
 * row is noise, and its absence is unambiguous); both halves at zero collapse to
 * an explicit "aucune carte à réviser". `counts === undefined` means the query
 * is still pending — the row falls back to its bare name instead of announcing a
 * zero it does not know yet.
 *
 * T-066 — `'unknown'` is the THIRD case, and it is not the pending one: a failed
 * read is final until someone asks again, so the row says so out loud rather
 * than staying silent for ever. Silence is right for a wait, wrong for a loss.
 */
export function dueRowLabel(
  t: TFunction,
  plural: (count: number) => PluralCategory,
  name: string,
  counts: DueRowState,
): string {
  if (counts === 'unknown') {
    return t('sidebar.dueRow.row', { name, counts: t('sidebar.dueRow.unknown') })
  }
  if (!counts) return name
  const { overdueCount: overdue, todayCount: today } = counts
  let summary: string
  if (overdue === 0 && today === 0) {
    summary = t('sidebar.dueRow.none')
  } else if (overdue === 0) {
    // No backlog half to carry the noun → the standalone wording.
    summary = t(`sidebar.dueRow.todayOnly_${plural(today)}`, { count: today })
  } else if (today === 0) {
    summary = t(`sidebar.dueRow.overdue_${plural(overdue)}`, { count: overdue })
  } else {
    summary = t('sidebar.dueRow.join', {
      first: t(`sidebar.dueRow.overdue_${plural(overdue)}`, { count: overdue }),
      second: t(`sidebar.dueRow.today_${plural(today)}`, { count: today }),
    })
  }
  return t('sidebar.dueRow.row', { name, counts: summary })
}
