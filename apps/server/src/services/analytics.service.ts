import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import type {
  DeckSuccessResponse,
  HeatmapResponse,
  RetentionResponse,
  ReviewVolumeResponse,
  StreaksResponse,
  StudyTimeResponse,
} from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, reviewLog, subject } from '../db/schema'
import { localDayDiff, localDayKey, localMidnight, localWeekStart } from '../lib/day'
import { ValidationError } from '../http/errors'

// --- Constants (isolated, assumed, adjustable) -----------------------------
/** Hard cap on a series/rate window, bounding scan cost and payload size. */
const MAX_WINDOW_DAYS = 366
/** Default trailing window (in days, inclusive) for the three series endpoints. */
const DEFAULT_SERIES_WINDOW_DAYS = 365
/** Below this denominator, retention/successRate is `null` (no misleading %). */
const MIN_RATE_SAMPLE = 10
/** FSRS-faithful "recall": rating >= 2 (Hard/Good/Easy); Again(1) is the miss. */
const RECALL_RATING_MIN = 2
/** rating >= 1 everywhere: a Manual(0) reschedule is never a study/memory event. */
const RATING_MIN_COUNTED = 1
/** State.Review — retention only counts mature (scheduled) cards. */
const REVIEW_STATE = 2

type Granularity = 'day' | 'week'

interface DateParts {
  y: number
  m: number // 1-based
  d: number
}

function parseDay(key: string): DateParts {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

// --- Series window (heatmap / study-time / review-volume) ------------------

interface SeriesWindow {
  from: string
  to: string
  fromParts: DateParts
  fromMidnight: Date
  endExclusive: Date
  dayCount: number
}

/**
 * Resolve a series window: `from`/`to` together or neither. Omitted → trailing
 * `DEFAULT_SERIES_WINDOW_DAYS` ending today. Guards: `from <= to`, cap at
 * `MAX_WINDOW_DAYS`. `to` inclusive → SQL high bound is exclusive.
 */
function resolveSeriesWindow(now: Date, from?: string, to?: string): SeriesWindow {
  if ((from === undefined) !== (to === undefined)) {
    throw new ValidationError('from and to must be provided together')
  }
  let fromKey: string
  let toKey: string
  if (from === undefined || to === undefined) {
    toKey = localDayKey(now)
    fromKey = localDayKey(
      localMidnight(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - (DEFAULT_SERIES_WINDOW_DAYS - 1),
      ),
    )
  } else {
    fromKey = from
    toKey = to
  }
  if (fromKey > toKey) throw new ValidationError('from must be <= to')
  const fromParts = parseDay(fromKey)
  const toParts = parseDay(toKey)
  const fromMidnight = localMidnight(fromParts.y, fromParts.m - 1, fromParts.d)
  const toMidnight = localMidnight(toParts.y, toParts.m - 1, toParts.d)
  const dayCount = localDayDiff(fromMidnight, toMidnight) + 1
  if (dayCount > MAX_WINDOW_DAYS) {
    throw new ValidationError(`window too large (max ${MAX_WINDOW_DAYS} days)`)
  }
  const endExclusive = localMidnight(toParts.y, toParts.m - 1, toParts.d + 1)
  return { from: fromKey, to: toKey, fromParts, fromMidnight, endExclusive, dayCount }
}

interface BucketDef {
  key: string
  daysInBucket: number
}

/**
 * Dense, ordered bucket scaffold over `[from, to]`. `day` → one bucket per day
 * (`daysInBucket = 1`). `week` → one bucket per ISO week (Monday key), with
 * `daysInBucket` counting only the week's days that fall inside the window
 * (1..7), so partial edge weeks are detectable client-side.
 */
function buildBuckets(w: SeriesWindow, granularity: Granularity): BucketDef[] {
  const { y, m, d } = w.fromParts
  if (granularity === 'day') {
    const out: BucketDef[] = []
    for (let i = 0; i < w.dayCount; i++) {
      out.push({ key: localDayKey(localMidnight(y, m - 1, d + i)), daysInBucket: 1 })
    }
    return out
  }
  const counts = new Map<string, number>()
  const order: string[] = []
  for (let i = 0; i < w.dayCount; i++) {
    const day = localMidnight(y, m - 1, d + i)
    const wk = localDayKey(localWeekStart(day))
    const prev = counts.get(wk)
    if (prev === undefined) {
      counts.set(wk, 1)
      order.push(wk)
    } else {
      counts.set(wk, prev + 1)
    }
  }
  return order.map((key) => ({ key, daysInBucket: counts.get(key) ?? 1 }))
}

/** Bucket key of a review instant for a given granularity (local, never SQL). */
function bucketKey(review: Date, granularity: Granularity): string {
  return granularity === 'week' ? localDayKey(localWeekStart(review)) : localDayKey(review)
}

// --- Optional rate window (retention / deck-success) -----------------------

interface RateWindow {
  from: string | null
  to: string | null
  clause: SQL | undefined
}

/**
 * Resolve an optional rate window: both provided (bounded, guarded) or neither
 * (all-time → `from`/`to` null, no SQL bound). Same order/size guards as series.
 */
function resolveRateWindow(from?: string, to?: string): RateWindow {
  if (from === undefined && to === undefined) return { from: null, to: null, clause: undefined }
  if (from === undefined || to === undefined) {
    throw new ValidationError('from and to must be provided together')
  }
  if (from > to) throw new ValidationError('from must be <= to')
  const fromParts = parseDay(from)
  const toParts = parseDay(to)
  const fromMidnight = localMidnight(fromParts.y, fromParts.m - 1, fromParts.d)
  const toMidnight = localMidnight(toParts.y, toParts.m - 1, toParts.d)
  if (localDayDiff(fromMidnight, toMidnight) + 1 > MAX_WINDOW_DAYS) {
    throw new ValidationError(`window too large (max ${MAX_WINDOW_DAYS} days)`)
  }
  const endExclusive = localMidnight(toParts.y, toParts.m - 1, toParts.d + 1)
  return {
    from,
    to,
    clause: and(gte(reviewLog.review, fromMidnight), lt(reviewLog.review, endExclusive)),
  }
}

// --- Endpoints -------------------------------------------------------------

export interface SeriesParams {
  now: Date
  from?: string
  to?: string
}
export interface GranularSeriesParams extends SeriesParams {
  granularity: Granularity
}
export interface RateParams {
  from?: string
  to?: string
}

/**
 * Reviews per local calendar day over a window — a dense contribution-graph
 * feed. One indexed range scan on `review`, no join (retrospective: the past is
 * immutable, archived state is not applied). Manual(0) excluded.
 */
export async function heatmap(db: DB, params: SeriesParams): Promise<HeatmapResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ review: reviewLog.review })
    .from(reviewLog)
    .where(
      and(
        gte(reviewLog.review, w.fromMidnight),
        lt(reviewLog.review, w.endExclusive),
        gte(reviewLog.rating, RATING_MIN_COUNTED),
      ),
    )

  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = localDayKey(r.review)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const { y, m, d } = w.fromParts
  const days: HeatmapResponse['days'] = []
  let total = 0
  let activeDays = 0
  let max = 0
  for (let i = 0; i < w.dayCount; i++) {
    const key = localDayKey(localMidnight(y, m - 1, d + i))
    const c = counts.get(key) ?? 0
    days.push({ date: key, count: c })
    total += c
    if (c > 0) activeDays += 1
    if (c > max) max = c
  }

  return { from: w.from, to: w.to, total, activeDays, max, days }
}

/**
 * Current + record streak. A study day = a local day with >= 1 review (Manual
 * excluded). One indexed scan, no join (retrospective; archiving never rewrites
 * an earned streak).
 */
export async function streaks(db: DB, now: Date): Promise<StreaksResponse> {
  const rows = await db
    .select({ review: reviewLog.review })
    .from(reviewLog)
    .where(gte(reviewLog.rating, RATING_MIN_COUNTED))
    .orderBy(desc(reviewLog.review))

  const daySet = new Set<string>()
  for (const r of rows) daySet.add(localDayKey(r.review))

  const lastStudyDay = rows.length > 0 && rows[0] ? localDayKey(rows[0].review) : null

  // Current streak: run of consecutive study days ending today or yesterday.
  const todayKey = localDayKey(now)
  const todayMidnight = localMidnight(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayMidnight = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  let includesToday = false
  let cursor: Date | null = null
  if (daySet.has(todayKey)) {
    includesToday = true
    cursor = todayMidnight
  } else if (daySet.has(localDayKey(yesterdayMidnight))) {
    cursor = yesterdayMidnight
  }
  let current = 0
  while (cursor && daySet.has(localDayKey(cursor))) {
    current += 1
    cursor = localMidnight(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1)
  }

  // Record streak: longest run of consecutive days over all history.
  const sortedKeys = [...daySet].sort()
  let longest = 0
  let run = 0
  let prev: Date | null = null
  for (const key of sortedKeys) {
    const p = parseDay(key)
    const mid = localMidnight(p.y, p.m - 1, p.d)
    run = prev && localDayDiff(prev, mid) === 1 ? run + 1 : 1
    if (run > longest) longest = run
    prev = mid
  }

  return {
    now: now.toISOString(),
    current,
    longest,
    includesToday,
    lastStudyDay,
    totalStudyDays: daySet.size,
  }
}

/**
 * Time spent per day/week — sum of non-null `durationMs` (NULL = not measured,
 * never counted as 0). One indexed range scan, no join. Manual(0) excluded.
 */
export async function studyTime(db: DB, params: GranularSeriesParams): Promise<StudyTimeResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ review: reviewLog.review, durationMs: reviewLog.durationMs })
    .from(reviewLog)
    .where(
      and(
        gte(reviewLog.review, w.fromMidnight),
        lt(reviewLog.review, w.endExclusive),
        gte(reviewLog.rating, RATING_MIN_COUNTED),
      ),
    )

  const buckets = buildBuckets(w, params.granularity)
  const acc = new Map<string, { durationMs: number; reviewCount: number; measuredCount: number }>()
  for (const b of buckets) acc.set(b.key, { durationMs: 0, reviewCount: 0, measuredCount: 0 })

  for (const r of rows) {
    const a = acc.get(bucketKey(r.review, params.granularity))
    if (!a) continue
    a.reviewCount += 1
    if (r.durationMs !== null) {
      a.durationMs += r.durationMs
      a.measuredCount += 1
    }
  }

  let totalMs = 0
  let totalReviews = 0
  let measuredReviews = 0
  const outBuckets = buckets.map((b) => {
    const a = acc.get(b.key) ?? { durationMs: 0, reviewCount: 0, measuredCount: 0 }
    totalMs += a.durationMs
    totalReviews += a.reviewCount
    measuredReviews += a.measuredCount
    return {
      date: b.key,
      daysInBucket: b.daysInBucket,
      durationMs: a.durationMs,
      reviewCount: a.reviewCount,
      measuredCount: a.measuredCount,
      avgMs: a.measuredCount > 0 ? Math.round(a.durationMs / a.measuredCount) : null,
    }
  })

  return {
    from: w.from,
    to: w.to,
    granularity: params.granularity,
    totalMs,
    totalReviews,
    measuredReviews,
    buckets: outBuckets,
  }
}

/**
 * Reviews per rating (Again/Hard/Good/Easy) per day/week. One indexed range
 * scan, no join. Manual(0) excluded in SQL → the 4 series + total can never
 * contain it.
 */
export async function reviewVolume(
  db: DB,
  params: GranularSeriesParams,
): Promise<ReviewVolumeResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ rating: reviewLog.rating, review: reviewLog.review })
    .from(reviewLog)
    .where(
      and(
        gte(reviewLog.review, w.fromMidnight),
        lt(reviewLog.review, w.endExclusive),
        gte(reviewLog.rating, RATING_MIN_COUNTED),
      ),
    )

  const buckets = buildBuckets(w, params.granularity)
  const acc = new Map<string, { again: number; hard: number; good: number; easy: number }>()
  for (const b of buckets) acc.set(b.key, { again: 0, hard: 0, good: 0, easy: 0 })

  for (const r of rows) {
    const a = acc.get(bucketKey(r.review, params.granularity))
    if (!a) continue
    if (r.rating === 1) a.again += 1
    else if (r.rating === 2) a.hard += 1
    else if (r.rating === 3) a.good += 1
    else if (r.rating === 4) a.easy += 1
  }

  const totals = { again: 0, hard: 0, good: 0, easy: 0, total: 0 }
  const outBuckets = buckets.map((b) => {
    const a = acc.get(b.key) ?? { again: 0, hard: 0, good: 0, easy: 0 }
    const total = a.again + a.hard + a.good + a.easy
    totals.again += a.again
    totals.hard += a.hard
    totals.good += a.good
    totals.easy += a.easy
    totals.total += total
    return {
      date: b.key,
      daysInBucket: b.daysInBucket,
      again: a.again,
      hard: a.hard,
      good: a.good,
      easy: a.easy,
      total,
    }
  })

  return { from: w.from, to: w.to, granularity: params.granularity, totals, buckets: outBuckets }
}

/**
 * True-retention per subject: recall rate over MATURE reviews only (state =
 * Review before the review). `retention = null` below `MIN_RATE_SAMPLE`.
 * Archived subjects excluded (present-tense view). Single aggregation query.
 */
export async function retention(db: DB, params: RateParams): Promise<RetentionResponse> {
  const win = resolveRateWindow(params.from, params.to)
  const rows = await db
    .select({
      subjectId: subject.id,
      maturedReviewed: count(reviewLog.id),
      // postgres-js serializes SUM(bigint) as a string; `.mapWith(Number)` keeps
      // the shared contract's `z.number().int()` satisfied. `count()` is already
      // Number-mapped by drizzle, so it needs no cast.
      recalled:
        sql<number>`coalesce(sum(case when ${reviewLog.rating} >= ${RECALL_RATING_MIN} then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
    })
    .from(subject)
    .leftJoin(deck, eq(deck.subjectId, subject.id))
    .leftJoin(card, eq(card.deckId, deck.id))
    .leftJoin(
      reviewLog,
      and(
        eq(reviewLog.cardId, card.id),
        eq(reviewLog.state, REVIEW_STATE),
        gte(reviewLog.rating, RATING_MIN_COUNTED),
        win.clause,
      ),
    )
    .where(eq(subject.archived, false))
    .groupBy(subject.id)

  const subjects = rows.map((r) => ({
    subjectId: r.subjectId,
    maturedReviewed: r.maturedReviewed,
    recalled: r.recalled,
    retention: r.maturedReviewed >= MIN_RATE_SAMPLE ? r.recalled / r.maturedReviewed : null,
  }))

  return { from: win.from, to: win.to, minSample: MIN_RATE_SAMPLE, subjects }
}

/**
 * Practical success rate per deck: `rating >= 2` over ALL reviews (every state,
 * learning reps included). `successRate = null` below `MIN_RATE_SAMPLE`.
 * Decks of archived subjects excluded. Single aggregation query.
 */
export async function deckSuccess(db: DB, params: RateParams): Promise<DeckSuccessResponse> {
  const win = resolveRateWindow(params.from, params.to)
  const rows = await db
    .select({
      deckId: deck.id,
      subjectId: subject.id,
      reviewed: count(reviewLog.id),
      // See `retention`: postgres-js returns SUM(bigint) as a string, so cast.
      passed:
        sql<number>`coalesce(sum(case when ${reviewLog.rating} >= ${RECALL_RATING_MIN} then 1 else 0 end), 0)`.mapWith(
          Number,
        ),
    })
    .from(deck)
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .leftJoin(card, eq(card.deckId, deck.id))
    .leftJoin(
      reviewLog,
      and(eq(reviewLog.cardId, card.id), gte(reviewLog.rating, RATING_MIN_COUNTED), win.clause),
    )
    .where(eq(subject.archived, false))
    // Postgres (unlike SQLite) requires every non-aggregated selected column in
    // GROUP BY. `subject.id` is functionally determined by `deck.id` (one subject
    // per deck) but pg cannot infer that across the join, so group by both.
    .groupBy(deck.id, subject.id)

  const decks = rows.map((r) => ({
    deckId: r.deckId,
    subjectId: r.subjectId,
    reviewed: r.reviewed,
    passed: r.passed,
    successRate: r.reviewed >= MIN_RATE_SAMPLE ? r.passed / r.reviewed : null,
  }))

  return { from: win.from, to: win.to, minSample: MIN_RATE_SAMPLE, decks }
}
