/**
 * Analytics queries (spec §1.6). `queryOptions` colocated here and shared by the
 * route loader and the components (Phase 1 pattern). The real endpoints speak
 * `from`/`to` local-day bounds — `window.ts` maps a preset to them.
 *
 * `staleTime` 5min (analytics is not real-time), `refetchOnWindowFocus` (fresh
 * on return), and `placeholderData: keepPreviousData` on the four windowed
 * queries so a window change holds the previous frame instead of flashing a
 * skeleton (spec §1.5).
 *
 * ═══ THE SUBJECT FILTER ═══
 *
 * Six endpoints take an OPTIONAL `subjectId`, and it is a filter, not a second
 * resource: the same query, narrowed by a predicate. So every option factory
 * below takes the same optional argument, passes it straight through, and puts
 * it in the cache key — `undefined` (every subject) and an id are two different
 * answers and must never share an entry.
 *
 * `streaksOptions` is the exception, and deliberately: the endpoint accepts no
 * `subjectId` at all. A streak measures a habit — showing up — and a habit
 * belongs to the person, not to one of their subjects (see `streaksQuerySchema`
 * in `@engram/shared`). The screens say so out loud rather than hiding the tile.
 */
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import {
  deckSuccessResponseSchema,
  examReadinessResponseSchema,
  heatmapResponseSchema,
  retentionResponseSchema,
  reviewVolumeResponseSchema,
  streaksResponseSchema,
  studyTimeResponseSchema,
} from '@engram/shared'
import { api, fetchHardestCards, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import {
  previousSeriesRange,
  rateRange,
  seriesRange,
  windowGranularity,
  type AnalyticsWindow,
} from './window'
import { passedCount, type RatingTotals } from './metrics'

const STALE = 5 * 60_000

/** Current + record streak (NOT window-scoped, and NOT subject-scoped). */
export function streaksOptions(now: Date) {
  const nowIso = now.toISOString()
  return queryOptions({
    queryKey: qk.analytics.streaks,
    queryFn: ({ signal }) =>
      api.get(`/analytics/streaks${qs({ now: nowIso })}`, streaksResponseSchema, signal),
    staleTime: STALE,
    refetchOnWindowFocus: true,
  })
}

/** One calendar year of daily review counts (dense). Its own stepper, no window. */
export function heatmapOptions(year: number, subjectId?: string) {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  return queryOptions({
    queryKey: qk.analytics.heatmap(year, subjectId),
    queryFn: ({ signal }) =>
      api.get(`/analytics/heatmap${qs({ from, to, subjectId })}`, heatmapResponseSchema, signal),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/** Study time per bucket over the window (drives the tile total + the area). */
export function studyTimeOptions(w: AnalyticsWindow, now: Date, subjectId?: string) {
  const { from, to } = seriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.studyTime(w, subjectId),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/study-time${qs({ from, to, granularity, subjectId })}`,
        studyTimeResponseSchema,
        signal,
      ),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/** Reviews per rating per bucket (drives the stacked columns + reviews/success tiles). */
export function reviewVolumeOptions(w: AnalyticsWindow, now: Date, subjectId?: string) {
  const { from, to } = seriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.volume(w, subjectId),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/review-volume${qs({ from, to, granularity, subjectId })}`,
        reviewVolumeResponseSchema,
        signal,
      ),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/**
 * True retention per subject over the window (`all` → all-time).
 *
 * Takes NO `subjectId` even though the endpoint accepts one: this chart IS the
 * comparison between subjects, and narrowing it to one leaves a single bar with
 * nothing to be compared against. The screen highlights the selected subject
 * among the others instead — see `RetentionBySubjectChart`.
 */
export function retentionOptions(w: AnalyticsWindow, now: Date) {
  const range = rateRange(w, now)
  return queryOptions({
    queryKey: qk.analytics.retention(w),
    queryFn: ({ signal }) =>
      api.get(`/analytics/retention${qs({ ...range })}`, retentionResponseSchema, signal),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/**
 * Success rate per deck over the window, for ONE subject. Only ever asked with a
 * subject: across every deck of every subject the ranking is a bag of unrelated
 * names, while inside a subject it is exactly the drill-down of the deck list
 * that screen already shows.
 */
export function deckSuccessOptions(w: AnalyticsWindow, now: Date, subjectId: string) {
  const range = rateRange(w, now)
  return queryOptions({
    queryKey: qk.analytics.deckSuccess(w, subjectId),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/deck-success${qs({ ...range, subjectId })}`,
        deckSuccessResponseSchema,
        signal,
      ),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/** How many hard cards the panel lists PER SUBJECT (bounded 1..20 server-side). */
export const HARDEST_CARDS_PER_SUBJECT = 5

/**
 * The hardest cards of each subject. NOT window-scoped, and deliberately so:
 * FSRS `difficulty` is the card's current state, not an aggregate over a period
 * — so no `placeholderData` dance either, the window filter never touches it.
 */
export function hardestCardsOptions(limit = HARDEST_CARDS_PER_SUBJECT, subjectId?: string) {
  return queryOptions({
    queryKey: qk.analytics.hardestCards(limit, subjectId),
    queryFn: ({ signal }) => fetchHardestCards(limit, signal, subjectId),
    staleTime: STALE,
    refetchOnWindowFocus: true,
  })
}

/**
 * "Am I ready for my exams?" — per subject, a figure for today plus one per
 * exam, projected onto the exam day.
 *
 * NOT window-scoped (it forecasts forward, it does not aggregate backwards), and
 * `now` is deliberately absent from the key: the caller freezes one `now` per
 * screen, and a projection that moves by minutes must not fragment the cache.
 * `staleTime` is shorter than the rest — this is the number someone refreshes
 * the page for the day before an exam.
 */
export function examReadinessOptions(now: Date, subjectId?: string) {
  const nowIso = now.toISOString()
  return queryOptions({
    queryKey: qk.analytics.examReadiness(subjectId),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/exam-readiness${qs({ now: nowIso, subjectId })}`,
        examReadinessResponseSchema,
        signal,
      ),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Previous-period totals for the tile deltas. `null` when there is no previous. */
export interface AnalyticsDeltas {
  studyMs: number
  reviews: number
  passed: number
}

export function deltasOptions(w: AnalyticsWindow, now: Date, subjectId?: string) {
  const prev = previousSeriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.deltas(w, subjectId),
    queryFn: async ({ signal }): Promise<AnalyticsDeltas | null> => {
      if (!prev) return null
      const [study, volume] = await Promise.all([
        api.get(
          `/analytics/study-time${qs({ from: prev.from, to: prev.to, granularity, subjectId })}`,
          studyTimeResponseSchema,
          signal,
        ),
        api.get(
          `/analytics/review-volume${qs({ from: prev.from, to: prev.to, granularity, subjectId })}`,
          reviewVolumeResponseSchema,
          signal,
        ),
      ])
      const totals: RatingTotals = volume.totals
      return { studyMs: study.totalMs, reviews: volume.totals.total, passed: passedCount(totals) }
    },
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}
