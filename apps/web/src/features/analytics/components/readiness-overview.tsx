import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { ExamReadinessResponse, Subject } from '@engram/shared'
import { useT, usePlural, type PluralCategory, type TFunction } from '@/lib/i18n'
import { formatLongDay } from '@/lib/format'
import { localDayKey } from '@/lib/calendar'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'
import { formatPercent } from '../metrics'
import {
  pastExamRows,
  readinessOverviewRows,
  readinessPercent,
  type ReadinessOverviewRow,
} from '../readiness'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartTableView } from './chart-table-view'
import { ReadinessBar } from './readiness-bar'

/**
 * Exam readiness ACROSS subjects — the triage view, and deliberately not the
 * subject panel repeated N times.
 *
 * This screen's job is comparison: which deadline is closest, and which subject
 * is furthest from being ready for it. So each row is one line per upcoming exam
 * — baseline, projection, composition bar — and the detail (every exam of one
 * subject, the counts in words, the past ones) lives on that subject's own page,
 * one click away through the row itself. Nothing is duplicated between the two;
 * the row is a summary that links to the panel.
 */
export function ReadinessOverview({
  data,
  subjects,
  subjectsUnavailable = false,
  now,
  isFetching,
  error,
  onRetry,
}: {
  data: ExamReadinessResponse | undefined
  subjects: Subject[]
  /**
   * The subject LIST failed (T-066). Every row here is filtered by `known`, so
   * without it this panel has nothing it can draw — and drawing nothing looked
   * exactly like "no exam coming up", the one thing the comment below says it
   * must never say by accident.
   */
  subjectsUnavailable?: boolean
  now: Date
  isFetching: boolean
  error: boolean
  onRetry: () => void
}) {
  const t = useT()
  const plural = usePlural()
  const byId = new Map(subjects.map((s) => [s.id, s]))
  const known = (r: ReadinessOverviewRow) => byId.has(r.subjectId)
  const upcoming = data ? readinessOverviewRows(data.subjects).filter(known) : []
  const past = data ? pastExamRows(data.subjects).filter(known) : []

  let body: ReactNode
  let table: ReactNode

  if ((error && !data) || subjectsUnavailable) {
    // A failed read is NOT "no exam coming up" — that mistake would quietly
    // reassure someone the week before a partial. It reaches this panel by two
    // doors: its own request, and the subject list every row is matched against.
    body = (
      <ChartEmpty
        variant="error"
        title={t('analytics.readiness.error')}
        onRetry={onRetry}
        height={160}
      />
    )
  } else if (data && upcoming.length === 0 && past.length === 0) {
    body = (
      <ChartEmpty
        title={t('analytics.readiness.overviewEmpty')}
        hint={t('analytics.readiness.overviewEmptyHint')}
        height={160}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {upcoming.length > 0 && (
          <ul className="flex flex-col">
            {upcoming.map((r) => (
              <li key={`${r.subjectId}-${r.exam.examId}`}>
                <OverviewRow
                  row={r}
                  subject={byId.get(r.subjectId)!}
                  now={now}
                  t={t}
                  plural={plural}
                />
              </li>
            ))}
          </ul>
        )}

        {upcoming.length === 0 && past.length > 0 && (
          <p className="text-sm text-text-muted">{t('analytics.readiness.overviewEmpty')}</p>
        )}

        {past.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
              {t('analytics.readiness.pastGroup')}
            </p>
            <ul className="flex flex-col gap-1">
              {past.map((r) => {
                const s = byId.get(r.subjectId)!
                return (
                  <li
                    key={`${r.subjectId}-${r.exam.examId}`}
                    className="flex items-baseline gap-2 py-0.5 text-sm"
                  >
                    <SubjectDot color={s.color} muted={s.archived} />
                    <span className="shrink-0 truncate text-text-muted">{s.name}</span>
                    <span className="min-w-0 flex-1 truncate text-text-faint">{r.exam.title}</span>
                    <span className="font-mono text-2xs tabular-nums text-text-faint">
                      {formatLongDay(localDayKey(new Date(r.exam.date)))}
                    </span>
                    <span className="text-2xs text-text-faint">
                      {t('analytics.readiness.pastNoForecast')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    )
    table = <OverviewTable rows={[...upcoming, ...past]} byId={byId} t={t} />
  }

  return (
    <ChartCard
      title={t('analytics.readiness.overviewTitle')}
      isFetching={isFetching}
      showToggle={table !== undefined}
      table={table}
      toolbar={
        data && (
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
            {t('analytics.readiness.threshold', { value: formatPercent(data.threshold) })}
          </span>
        )
      }
    >
      {body}
    </ChartCard>
  )
}

/**
 * One exam, one line. The whole reading is "where I stand today → where I will
 * stand on the day", so both numbers are on the row; the bar underneath carries
 * the composition of the projected one, and a never-seen count is called out in
 * words because a hatched sliver is a hint, not a statement.
 */
function OverviewRow({
  row,
  subject,
  now,
  t,
  plural,
}: {
  row: ReadinessOverviewRow
  subject: Subject
  now: Date
  t: TFunction
  plural: (n: number) => PluralCategory
}) {
  const projection = row.exam.projection
  const todayPct = readinessPercent(row.today.readiness)
  const examPct = projection ? readinessPercent(projection.readiness) : null
  const noCards = row.exam.status === 'no_cards' || !projection || projection.cardTotal === 0

  return (
    <Link
      to="/subjects/$subjectId"
      params={{ subjectId: row.subjectId }}
      className="-mx-2 flex flex-col gap-1.5 rounded-sm px-2 py-2.5 transition-colors duration-fast hover:bg-surface-3 focus-visible:bg-surface-3"
    >
      <div className="flex items-baseline gap-2">
        <SubjectDot color={subject.color} muted={subject.archived} />
        <span className="shrink-0 truncate text-sm font-medium text-text">{subject.name}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-text-muted">{row.exam.title}</span>
        <Countdown dateIso={row.exam.date} now={now} />
        <span className="hidden font-mono text-2xs tabular-nums text-text-faint sm:inline">
          {formatLongDay(localDayKey(new Date(row.exam.date)))}
        </span>
      </div>

      {noCards ? (
        <p className="flex items-center gap-1.5 pl-4 text-sm text-text-muted">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          {t('analytics.readiness.noCardsShort')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4">
          {/* Fixed width: the bars of every row must start at the same x and end
              at the same x, or the lengths they encode stop being comparable.
              That is also why the never-seen callout drops to its own line on a
              narrow screen instead of eating into the bar of that row only. */}
          <span className="flex w-32 shrink-0 items-baseline justify-end gap-1 font-mono text-xs tabular-nums text-text-faint">
            {todayPct === null ? '—' : `${todayPct} %`}
            <ArrowRight className="size-3 self-center" aria-hidden />
            <span className="text-sm text-text">{examPct === null ? '—' : `${examPct} %`}</span>
          </span>
          <ReadinessBar
            breakdown={projection}
            colorHex={subject.color}
            className="max-w-[22rem] min-w-32 flex-1"
          />
          {projection.neverReviewed > 0 && (
            <span className="shrink-0 basis-full pl-[8.75rem] text-2xs text-text-faint sm:basis-auto sm:pl-0">
              {t(`analytics.readiness.neverShort_${plural(projection.neverReviewed)}`, {
                count: projection.neverReviewed,
              })}
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

function OverviewTable({
  rows,
  byId,
  t,
}: {
  rows: ReadinessOverviewRow[]
  byId: Map<string, Subject>
  t: TFunction
}) {
  interface Cell {
    key: string
    subject: string
    exam: string
    when: string
    today: string
    projected: string
    never: string
  }
  const cells: Cell[] = rows.map((r) => ({
    key: `${r.subjectId}-${r.exam.examId}`,
    subject: byId.get(r.subjectId)?.name ?? r.subjectId,
    exam: r.exam.title,
    when: formatLongDay(localDayKey(new Date(r.exam.date))),
    today: cell(readinessPercent(r.today.readiness)),
    projected: r.exam.projection ? cell(readinessPercent(r.exam.projection.readiness)) : '—',
    never: r.exam.projection ? String(r.exam.projection.neverReviewed) : '—',
  }))
  return (
    <ChartTableView
      columns={[
        { key: 'subject', header: t('analytics.colSubject'), render: (c: Cell) => c.subject },
        { key: 'exam', header: t('analytics.readiness.colExam'), render: (c) => c.exam },
        {
          key: 'when',
          header: t('analytics.readiness.colWhen'),
          mono: true,
          render: (c) => c.when,
        },
        {
          key: 'today',
          header: t('analytics.readiness.colToday'),
          align: 'right',
          mono: true,
          render: (c) => c.today,
        },
        {
          key: 'projected',
          header: t('analytics.readiness.colProjected'),
          align: 'right',
          mono: true,
          render: (c) => c.projected,
        },
        {
          key: 'never',
          header: t('analytics.readiness.colNever'),
          align: 'right',
          mono: true,
          render: (c) => c.never,
        },
      ]}
      rows={cells}
      rowKey={(c) => c.key}
      caption={t('analytics.readiness.overviewCaption')}
    />
  )
}

function cell(p: number | null): string {
  return p === null ? '—' : `${p} %`
}
