import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import type { ExamReadiness, ReadinessBreakdown, Subject, SubjectReadiness } from '@engram/shared'
import { useT, usePlural, type TFunction } from '@/lib/i18n'
import { formatLongDay } from '@/lib/format'
import { localDayKey } from '@/lib/calendar'
import { Countdown } from '@/components/countdown'
import { cn } from '@/lib/utils'
import { formatPercent } from '../metrics'
import { readinessDeltaPoints, readinessPercent, splitExams } from '../readiness'
import { ChartCard } from './chart-card'
import { ChartEmpty } from './chart-empty'
import { ChartTableView } from './chart-table-view'
import { ReadinessGauge } from './readiness-gauge'

/**
 * "Am I ready?" for ONE subject — the panel this whole batch exists for.
 *
 * It answers in three parts, and each one is a rule, not a layout preference:
 *
 *  · TODAY IS ALWAYS SHOWN, first. The server sends it for every subject,
 *    exam or no exam, and it is what gives an exam figure a baseline: "62 %
 *    today → 41 % on exam day" is a decision, "41 %" alone is a mood.
 *  · A SUBJECT WITH NO CARD GETS A SENTENCE, NOT A GAUGE. That is literally the
 *    reported defect: an exam created three weeks out on an empty subject, about
 *    which the app said nothing. There is no percentage to show (0 of 0 is not
 *    0 %), so the panel names the exam, its date, and what to do about it.
 *  · A PAST EXAM KEEPS ITS ROW AND LOSES ITS GAUGE. The server sends `status:
 *    'past'` with a null projection; forecasting a day already gone would be
 *    fiction, and hiding the exam would be amnesia.
 */
export function ReadinessPanel({
  data,
  subject,
  threshold,
  now,
  isFetching,
  error,
  onRetry,
  noCardsAction,
}: {
  data: SubjectReadiness | undefined
  subject: Subject
  threshold: number
  now: Date
  isFetching: boolean
  error: boolean
  onRetry: () => void
  /** What to offer when the subject holds no card (create a deck, import notes…). */
  noCardsAction?: ReactNode
}) {
  const t = useT()
  const plural = usePlural()

  let body: ReactNode
  let table: ReactNode

  if (error && !data) {
    // A read that FAILED is not a subject with nothing in it (fix, twice this
    // week): it says so, and offers the retry.
    body = (
      <ChartEmpty
        variant="error"
        title={t('analytics.readiness.error')}
        onRetry={onRetry}
        height={160}
      />
    )
  } else if (!data) {
    body = <ChartEmpty title={t('analytics.readiness.unknownSubject')} height={160} />
  } else {
    const { upcoming, past } = splitExams(data.exams)
    const empty = data.today.cardTotal === 0

    body = (
      <div className="flex flex-col gap-5">
        {empty ? (
          <NoCardsNotice exams={upcoming} now={now} action={noCardsAction} />
        ) : (
          <>
            <ReadinessGauge
              title={
                <span className="text-sm font-medium text-text">
                  {t('analytics.readiness.todayLabel')}
                </span>
              }
              meta={
                <span className="font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
                  {t('analytics.readiness.baseline')}
                </span>
              }
              breakdown={data.today}
              colorHex={subject.color}
              emphasis="primary"
            />
            {data.today.neverReviewed > 0 && (
              <Note icon={<Info className="size-3.5" aria-hidden />}>
                {t(`analytics.readiness.neverCountedNote_${plural(data.today.neverReviewed)}`, {
                  count: data.today.neverReviewed,
                })}
              </Note>
            )}
          </>
        )}

        {!empty && upcoming.length > 0 && (
          <ul className="flex flex-col gap-5 border-t border-border pt-5">
            {upcoming.map((e) => (
              <li key={e.examId}>
                <ExamGauge exam={e} subject={subject} today={data.today} now={now} t={t} />
              </li>
            ))}
          </ul>
        )}

        {!empty && upcoming.length === 0 && (
          <p className="border-t border-border pt-4 text-sm text-text-muted">
            {t('analytics.readiness.noExam')}{' '}
            <span className="text-text-faint">{t('analytics.readiness.noExamHint')}</span>
          </p>
        )}

        {past.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
              {t('analytics.readiness.pastGroup')}
            </p>
            <ul className="flex flex-col gap-1.5">
              {past.map((e) => (
                <li key={e.examId} className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-text-muted">{e.title}</span>
                  <span className="font-mono text-2xs tabular-nums text-text-faint">
                    {formatLongDay(localDayKey(new Date(e.date)))}
                  </span>
                  {/* No gauge, no percentage, no fabricated number. */}
                  <span className="text-2xs text-text-faint">
                    {t('analytics.readiness.pastNoForecast')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )

    table = <ReadinessTable data={data} t={t} />
  }

  return (
    <ChartCard
      title={t('analytics.readiness.title')}
      isFetching={isFetching}
      showToggle={table !== undefined}
      table={table}
      toolbar={
        <span className="font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
          {t('analytics.readiness.threshold', { value: formatPercent(threshold) })}
        </span>
      }
    >
      {body}
    </ChartCard>
  )
}

/** One upcoming exam: countdown, date, gauge, and its delta against today. */
function ExamGauge({
  exam,
  subject,
  today,
  now,
  t,
}: {
  exam: ExamReadiness
  subject: Subject
  today: ReadinessBreakdown
  now: Date
  t: TFunction
}) {
  const title = <span className="truncate text-sm font-medium text-text">{exam.title}</span>
  const meta = (
    <span className="flex shrink-0 items-center gap-2">
      <Countdown dateIso={exam.date} now={now} />
      <span className="font-mono text-2xs tabular-nums text-text-faint">
        {formatLongDay(localDayKey(new Date(exam.date)))}
      </span>
    </span>
  )

  // `no_cards` still carries a fully zeroed projection, but a bar of nothing
  // says nothing: the row states the cause instead.
  if (exam.status === 'no_cards' || !exam.projection) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1">{title}</div>
          {meta}
        </div>
        <p className="flex items-center gap-1.5 text-sm text-text-muted">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          {t('analytics.readiness.noCardsShort')}
        </p>
      </div>
    )
  }

  return (
    <ReadinessGauge
      title={title}
      meta={meta}
      breakdown={exam.projection}
      colorHex={subject.color}
      deltaPoints={readinessDeltaPoints(today, exam.projection)}
    />
  )
}

/**
 * The empty-subject case, spelt out. Names every exam it is about to cost, with
 * the date, because "you have no cards" is only actionable when it is attached to
 * a deadline.
 */
function NoCardsNotice({
  exams,
  now,
  action,
}: {
  exams: ExamReadiness[]
  now: Date
  action?: ReactNode
}) {
  const t = useT()
  return (
    <div className="rounded-md border border-warning/30 bg-warning-subtle p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-text">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
        {t('analytics.readiness.noCardsTitle')}
      </p>
      <p className="mt-1.5 text-sm text-text-muted">
        {exams.length > 0
          ? t('analytics.readiness.noCardsWithExam')
          : t('analytics.readiness.noCardsNoExam')}
      </p>
      {exams.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {exams.map((e) => (
            <li key={e.examId} className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-text">{e.title}</span>
              <Countdown dateIso={e.date} now={now} />
              <span className="font-mono text-2xs tabular-nums text-text-faint">
                {formatLongDay(localDayKey(new Date(e.date)))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-text-faint')}>
      <span className="mt-px shrink-0">{icon}</span>
      {children}
    </p>
  )
}

interface Row {
  key: string
  label: string
  when: string
  ready: string
  never: string
  readiness: string
}

/** The table twin: today's row plus one per exam, past ones included with dashes. */
function ReadinessTable({ data, t }: { data: SubjectReadiness; t: TFunction }) {
  const rows: Row[] = [
    {
      key: 'today',
      label: t('analytics.readiness.todayLabel'),
      when: formatLongDay(localDayKey(new Date(data.today.at))),
      ready: `${data.today.ready} / ${data.today.cardTotal}`,
      never: String(data.today.neverReviewed),
      readiness: percentCell(data.today.readiness),
    },
    ...data.exams.map((e) => ({
      key: e.examId,
      label: e.title,
      when: formatLongDay(localDayKey(new Date(e.date))),
      ready: e.projection ? `${e.projection.ready} / ${e.projection.cardTotal}` : '—',
      never: e.projection ? String(e.projection.neverReviewed) : '—',
      readiness: e.projection ? percentCell(e.projection.readiness) : '—',
    })),
  ]
  return (
    <ChartTableView
      columns={[
        { key: 'label', header: t('analytics.readiness.colExam'), render: (r: Row) => r.label },
        {
          key: 'when',
          header: t('analytics.readiness.colWhen'),
          mono: true,
          render: (r) => r.when,
        },
        {
          key: 'ready',
          header: t('analytics.readiness.colReady'),
          align: 'right',
          mono: true,
          render: (r) => r.ready,
        },
        {
          key: 'never',
          header: t('analytics.readiness.colNever'),
          align: 'right',
          mono: true,
          render: (r) => r.never,
        },
        {
          key: 'readiness',
          header: t('analytics.readiness.colReadiness'),
          align: 'right',
          mono: true,
          render: (r) => r.readiness,
        },
      ]}
      rows={rows}
      rowKey={(r) => r.key}
      caption={t('analytics.readiness.caption')}
    />
  )
}

function percentCell(readiness: number | null): string {
  const p = readinessPercent(readiness)
  return p === null ? '—' : `${p} %`
}
