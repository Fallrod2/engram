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
  isFetching,
  error,
  onRetry,
}: {
  data: HardestCardsResponse | undefined
  subjects: Subject[]
  isFetching: boolean
  error: boolean
  onRetry: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const groups = data ? groupBySubject(data, subjects) : []
  const isEmpty = data !== undefined && groups.length === 0

  let body: React.ReactNode
  if (error && !data) {
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
                  <span
                    className="font-mono text-xs tabular-nums text-text"
                    aria-label={t('analytics.hardestDifficultyAria', {
                      value: c.difficulty.toFixed(1),
                    })}
                  >
                    {c.difficulty.toFixed(1)}
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
