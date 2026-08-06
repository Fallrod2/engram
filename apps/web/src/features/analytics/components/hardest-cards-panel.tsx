import type { HardestCardsResponse, Subject } from '@engram/shared'
import { SubjectDot } from '@/components/subject-dot'
import { flattenMarkdown } from '@/lib/markdown'
import { useT, usePlural } from '@/lib/i18n'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'

/**
 * "Where you keep failing": the hardest cards of each subject, ranked on the
 * FSRS `difficulty` the scheduler already maintains (1 easy .. 10 hard).
 *
 * It shares the screen's panel shell (`ChartCard`) but has NO graph/table
 * toggle — it is already a table-like list, a second view would be a duplicate.
 *
 * Two things this panel must not lie about:
 *   1. it is NOT window-scoped (difficulty is a current state, not a period
 *      aggregate) — hence the scope label in the header rather than the
 *      "sur {window}" subtitle the windowed charts carry;
 *   2. its empty state is NOT "no data": the server drops never-reviewed cards
 *      and anything under `minReps`, so the honest message is "not enough
 *      reviews yet", quoting the threshold the server sends back.
 */

/**
 * Top of the FSRS difficulty scale. ts-fsrs keeps `difficulty` on 1..10 and the
 * session's `DifficultyGauge` divides that same 10 into five segments — the two
 * marks read the same number, so they must name the same maximum.
 */
const DIFFICULTY_MAX = 10

interface Group {
  subjectId: string
  name: string
  color: string
  cards: HardestCardsResponse['cards']
}

/**
 * Group the flat server list by subject, PRESERVING encounter order: the server
 * sorts globally by difficulty, so the subject holding the single hardest card
 * comes first. Cards whose subject is unknown client-side are dropped.
 */
function groupBySubject(data: HardestCardsResponse, subjects: Subject[]): Group[] {
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const groups: Group[] = []
  const index = new Map<string, Group>()
  for (const c of data.cards) {
    const s = byId.get(c.subjectId)
    if (!s) continue
    let g = index.get(c.subjectId)
    if (!g) {
      g = { subjectId: c.subjectId, name: s.name, color: s.color, cards: [] }
      index.set(c.subjectId, g)
      groups.push(g)
    }
    g.cards.push(c)
  }
  return groups
}

export function HardestCardsPanel({
  data,
  subjects,
  subjectsUnavailable = false,
  isFetching,
  error,
  onRetry,
}: {
  data: HardestCardsResponse | undefined
  subjects: Subject[]
  /**
   * The subject LIST failed (T-066). `groupBySubject` drops every card whose
   * subject it cannot name, so an unread list emptied the panel and the empty
   * state then blamed the user's review history for it.
   */
  subjectsUnavailable?: boolean
  isFetching: boolean
  error: boolean
  onRetry: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const groups = data ? groupBySubject(data, subjects) : []
  const isEmpty = data !== undefined && groups.length === 0

  let body: React.ReactNode
  if ((error && !data) || subjectsUnavailable) {
    body = (
      <ChartEmpty
        variant="error"
        title={t('analytics.hardestError')}
        onRetry={onRetry}
        height={180}
      />
    )
  } else if (isEmpty) {
    const minReps = data?.minReps ?? 0
    body = (
      <ChartEmpty
        title={t('analytics.hardestEmpty')}
        hint={t(`analytics.hardestHint_${plural(minReps)}`, { count: minReps })}
        height={180}
      />
    )
  } else {
    body = (
      <ul className="flex flex-col gap-4">
        {groups.map((g) => (
          <li key={g.subjectId}>
            <div className="mb-1 flex items-center gap-2">
              <SubjectDot color={g.color} />
              <span className="min-w-0 truncate text-sm font-medium text-text">{g.name}</span>
            </div>
            <ul>
              {g.cards.map((c) => (
                <li
                  key={c.cardId}
                  className="flex items-baseline gap-3 border-t border-border py-1.5 first:border-t-0"
                >
                  {/* The excerpt is Markdown: flattened to ONE plain-text line
                      (never rendered) — this is a dense list, not a reader. */}
                  <span className="min-w-0 flex-1 truncate text-sm text-text-muted">
                    {flattenMarkdown(c.front)}
                  </span>
                  {/* T-036 — `7.4` alone is a number with no unit. The scale was
                      only ever in the `aria-label`, so the one reader who could
                      not see the list was the only one told what it was out of.
                      The denominator is now printed, faintly: it costs three
                      glyphs, it is the same `n/max` shape the retention
                      countdown uses, and the label stays the sentence. */}
                  <span
                    className="font-mono text-xs tabular-nums text-text"
                    aria-label={t('analytics.hardestDifficultyAria', {
                      value: c.difficulty.toFixed(1),
                    })}
                  >
                    {c.difficulty.toFixed(1)}
                    <span className="text-text-faint">/{DIFFICULTY_MAX}</span>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ChartCard
      title={t('analytics.hardestTitle')}
      isFetching={isFetching}
      showToggle={false}
      toolbar={
        <span className="font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
          {t('analytics.hardestScope')}
        </span>
      }
    >
      {body}
    </ChartCard>
  )
}
