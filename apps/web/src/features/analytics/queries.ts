/**
 * Analytics queries (spec §1.6). `queryOptions` colocated here and shared by the
 * route loader and the components (Phase 1 pattern). The real endpoints speak
 * `from`/`to` local-day bounds — `window.ts` maps a preset to them.
 *
 * `staleTime` 5min (analytics is not real-time), `refetchOnWindowFocus` (fresh
 * on return), and `placeholderData: keepPreviousData` on the four windowed
 * queries so a window change holds the previous frame instead of flashing a
 * skeleton (spec §1.5).
 */
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import {
  heatmapResponseSchema,
  retentionResponseSchema,
  reviewVolumeResponseSchema,
  streaksResponseSchema,
  studyTimeResponseSchema,
} from '@engram/shared'
import { api, qs } from '@/lib/api'
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

/** Current + record streak (NOT window-scoped). */
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
export function heatmapOptions(year: number) {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  return queryOptions({
    queryKey: qk.analytics.heatmap(year),
    queryFn: ({ signal }) =>
      api.get(`/analytics/heatmap${qs({ from, to })}`, heatmapResponseSchema, signal),
    staleTime: STALE,
    refetchOnWindowFocus: true,
  })
}

/** Study time per bucket over the window (drives the tile total + the area). */
export function studyTimeOptions(w: AnalyticsWindow, now: Date) {
  const { from, to } = seriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.studyTime(w),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/study-time${qs({ from, to, granularity })}`,
        studyTimeResponseSchema,
        signal,
      ),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/** Reviews per rating per bucket (drives the stacked columns + reviews/success tiles). */
export function reviewVolumeOptions(w: AnalyticsWindow, now: Date) {
  const { from, to } = seriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.volume(w),
    queryFn: ({ signal }) =>
      api.get(
        `/analytics/review-volume${qs({ from, to, granularity })}`,
        reviewVolumeResponseSchema,
        signal,
      ),
    staleTime: STALE,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  })
}

/** True retention per subject over the window (`all` → all-time). */
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

/** Previous-period totals for the tile deltas. `null` when there is no previous. */
export interface AnalyticsDeltas {
  studyMs: number
  reviews: number
  passed: number
}

export function deltasOptions(w: AnalyticsWindow, now: Date) {
  const prev = previousSeriesRange(w, now)
  const granularity = windowGranularity(w)
  return queryOptions({
    queryKey: qk.analytics.deltas(w),
    queryFn: async ({ signal }): Promise<AnalyticsDeltas | null> => {
      if (!prev) return null
      const [study, volume] = await Promise.all([
        api.get(
          `/analytics/study-time${qs({ from: prev.from, to: prev.to, granularity })}`,
          studyTimeResponseSchema,
          signal,
        ),
        api.get(
          `/analytics/review-volume${qs({ from: prev.from, to: prev.to, granularity })}`,
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
