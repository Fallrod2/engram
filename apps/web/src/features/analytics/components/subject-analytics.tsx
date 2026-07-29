import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import type { Deck, Subject } from '@engram/shared'
import { useT, usePlural } from '@/lib/i18n'
import { formatPercent } from '../metrics'
import { deckSuccessOptions, examReadinessOptions, hardestCardsOptions } from '../queries'
import { windowLabel, type AnalyticsWindow } from '../window'
import { ChartCardSkeleton, HardestCardsSkeleton, ReadinessSkeleton } from './analytics-skeletons'
import { DeckSuccessChart } from './deck-success-chart'
import { HardestCardsPanel } from './hardest-cards-panel'
import { ReadinessPanel } from './readiness-panel'

/**
 * The statistics section of ONE subject's page — "how is this subject going, and
 * what do I do next", as opposed to the Analytics screen's "how do my subjects
 * compare".
 *
 * ═══ WHAT IS HERE, AND WHAT IS DELIBERATELY NOT ═══
 *
 * Here, because each answer only exists inside a subject:
 *   · exam readiness, in full — today's baseline, every exam, the composition;
 *   · success rate per deck — the drill-down of the deck list right above it;
 *   · the hardest cards of this subject — the list you act on.
 *
 * NOT here: the heatmap, the volume columns, the study-time area, retention by
 * subject. Those are trends and comparisons; the Analytics screen owns them and
 * its subject filter already narrows them to this same subject. Copying them
 * would double the maintenance and the request count for a second-best version
 * of a screen that is one click away — hence the link in this header instead.
 *
 * ═══ THE WINDOW ═══
 *
 * Fixed at 30 days here, and labelled. This section is a status board, not an
 * exploration surface; anyone who wants 90 days or all-time follows the link and
 * gets the real filter rank. Readiness itself is window-free (it forecasts).
 */
const SUBJECT_WINDOW: AnalyticsWindow = '30d'

export function SubjectAnalytics({
  subject,
  decks,
  noCardsAction,
}: {
  subject: Subject
  decks: Deck[]
  /** Offered when the subject holds no card at all (the origin defect). */
  noCardsAction?: ReactNode
}) {
  const t = useT()
  const plural = usePlural()
  // ONE frozen clock for the section: the readiness projection is anchored to it,
  // and a `now` that moved between panels would make two of them disagree.
  const [now] = useState(() => new Date())

  // No deck ⇒ no card ⇒ nothing for these two to rank, and the route already
  // holds the deck list: skipping the two requests costs nothing to know.
  // Readiness is asked ALWAYS — a subject with no card and an exam is precisely
  // what it has to talk about.
  const hasDecks = decks.length > 0
  const readinessQuery = useQuery(examReadinessOptions(now, subject.id))
  const deckSuccessQuery = useQuery({
    ...deckSuccessOptions(SUBJECT_WINDOW, now, subject.id),
    enabled: hasDecks,
  })
  const hardestQuery = useQuery({ ...hardestCardsOptions(5, subject.id), enabled: hasDecks })

  const label = windowLabel(SUBJECT_WINDOW)
  const readiness = readinessQuery.data?.subjects.find((s) => s.subjectId === subject.id)
  // A KNOWN zero. If the readiness read failed we do not know, and the two
  // panels stay up to speak for themselves rather than vanish on a guess.
  const noCards = readiness ? readiness.today.cardTotal === 0 : !hasDecks
  const totals = deckSuccessQuery.data?.decks.reduce(
    (acc, d) => ({ reviewed: acc.reviewed + d.reviewed, passed: acc.passed + d.passed }),
    { reviewed: 0, passed: 0 },
  )

  return (
    <section className="mt-10 flex flex-col gap-4" aria-labelledby="subject-analytics-title">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id="subject-analytics-title"
          className="text-lg font-semibold tracking-[-0.01em] text-text"
        >
          {t('analytics.subjectSectionTitle')}
        </h2>
        {/* Only rendered from data we actually have: a failed read leaves the
            line out rather than printing "0 review · 0 %". */}
        {totals && totals.reviewed > 0 && (
          <p className="font-mono text-2xs tabular-nums text-text-faint">
            {t(`analytics.reviewsCount_${plural(totals.reviewed)}`, { count: totals.reviewed })}
            <span className="mx-1.5 text-border-strong">·</span>
            {t('analytics.successRateOf', {
              value: formatPercent(totals.passed / totals.reviewed),
            })}
            <span className="mx-1.5 text-border-strong">·</span>
            {label}
          </p>
        )}
        <Link
          to="/analytics"
          search={{ window: SUBJECT_WINDOW, subject: subject.id }}
          className="ml-auto flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text"
        >
          {t('analytics.openInAnalytics')}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {readinessQuery.data || readinessQuery.isError ? (
        <ReadinessPanel
          data={readiness}
          subject={subject}
          threshold={readinessQuery.data?.threshold ?? 0.9}
          now={now}
          isFetching={readinessQuery.isFetching}
          error={readinessQuery.isError}
          onRetry={() => void readinessQuery.refetch()}
          {...(noCardsAction ? { noCardsAction } : {})}
        />
      ) : (
        <ReadinessSkeleton />
      )}

      {/* A subject holding zero cards gets the readiness notice and nothing else:
          "not enough reviews to rank" twice under it would be two empty panels
          restating what the notice already said, and burying it. Only skipped on
          a KNOWN zero — if the readiness read failed we do not know, so the
          panels stay and speak for themselves. */}
      {!noCards && (
        <div className="grid gap-4 lg:grid-cols-2">
          {deckSuccessQuery.data || deckSuccessQuery.isError ? (
            <DeckSuccessChart
              data={deckSuccessQuery.data}
              decks={decks}
              subject={subject}
              windowLabel={label}
              isFetching={deckSuccessQuery.isFetching}
              error={deckSuccessQuery.isError}
              onRetry={() => void deckSuccessQuery.refetch()}
            />
          ) : (
            <ChartCardSkeleton height={160} />
          )}

          {hardestQuery.data || hardestQuery.isError ? (
            <HardestCardsPanel
              data={hardestQuery.data}
              subjects={[subject]}
              isFetching={hardestQuery.isFetching}
              error={hardestQuery.isError}
              onRetry={() => void hardestQuery.refetch()}
            />
          ) : (
            <HardestCardsSkeleton />
          )}
        </div>
      )}
    </section>
  )
}
