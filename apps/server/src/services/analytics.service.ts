import { and, asc, count, desc, eq, gt, gte, lt, lte, sql, type SQL } from 'drizzle-orm'
import type {
  DeckSuccessResponse,
  HardestCardsResponse,
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
/**
 * Minimum `card.reps` for a card to enter the "hardest cards" ranking. A card
 * answered once has a difficulty FSRS has not had time to calibrate; ranking it
 * would present noise as a fact. Returned to the client as `minReps` so the UI
 * can say WHY a subject is missing (mirrors `retention`'s `minSample`).
 */
export const MIN_REPS = 3
/**
 * Length of the `front` excerpt returned by `hardestCards`. It is a dense list,
 * not a reader: the whole Markdown recto would bloat the payload for nothing.
 * Truncation is a hard character cut (no Markdown-aware cleanup — the UI
 * flattens the excerpt at render time).
 */
const FRONT_EXCERPT_CHARS = 160

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
export interface HardestCardsParams {
  /** Cards kept PER SUBJECT (bounded 1..20 by `hardestCardsQuerySchema`). */
  limit: number
}

/**
 * Reviews per local calendar day over a window — a dense contribution-graph
 * feed. One indexed range scan on `review`, no join (retrospective: the past is
 * immutable, archived state is not applied). Manual(0) excluded.
 */
export async function heatmap(
  db: DB,
  userId: string,
  params: SeriesParams,
): Promise<HeatmapResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ review: reviewLog.review })
    .from(reviewLog)
    .where(
      and(
        eq(reviewLog.userId, userId),
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
export async function streaks(db: DB, userId: string, now: Date): Promise<StreaksResponse> {
  const rows = await db
    .select({ review: reviewLog.review })
    .from(reviewLog)
    .where(and(eq(reviewLog.userId, userId), gte(reviewLog.rating, RATING_MIN_COUNTED)))
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
export async function studyTime(
  db: DB,
  userId: string,
  params: GranularSeriesParams,
): Promise<StudyTimeResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ review: reviewLog.review, durationMs: reviewLog.durationMs })
    .from(reviewLog)
    .where(
      and(
        eq(reviewLog.userId, userId),
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
  userId: string,
  params: GranularSeriesParams,
): Promise<ReviewVolumeResponse> {
  const w = resolveSeriesWindow(params.now, params.from, params.to)
  const rows = await db
    .select({ rating: reviewLog.rating, review: reviewLog.review })
    .from(reviewLog)
    .where(
      and(
        eq(reviewLog.userId, userId),
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
export async function retention(
  db: DB,
  userId: string,
  params: RateParams,
): Promise<RetentionResponse> {
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
    .where(and(eq(subject.userId, userId), eq(subject.archived, false)))
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
export async function deckSuccess(
  db: DB,
  userId: string,
  params: RateParams,
): Promise<DeckSuccessResponse> {
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
    .where(and(eq(subject.userId, userId), eq(subject.archived, false)))
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

/**
 * The `limit` hardest cards OF EACH SUBJECT, ranked by the FSRS `difficulty`
 * already persisted on the card.
 *
 * NO TIME WINDOW — deliberately, unlike its neighbours: `difficulty` is a
 * CURRENT STATE maintained by ts-fsrs, not an aggregate over a period. Filtering
 * it by `from`/`to` would mean nothing (there is no date to filter on but the
 * card's own last review, which is not what "hardest right now" asks).
 *
 * WHAT IS EXCLUDED, AND WHY. `difficulty` defaults to `0` and ts-fsrs only
 * writes a real value on the first review, so a never-reviewed card sits at `0`,
 * outside the 1-10 scale: it is UNKNOWN, not easy, and has no place in a ranking
 * of hard cards (`difficulty > 0`). Cards below `MIN_REPS` are dropped for the
 * same reason at the other end: too few answers for FSRS to have calibrated
 * anything. Archived subjects are excluded (present-tense view) and everything
 * is scoped by `subject.userId`, exactly like `deckSuccess`.
 *
 * TOP-N PER SUBJECT via `row_number() over (partition by subject order by ...)`
 * in a subquery, filtered to `<= limit` outside — one query, no fan-out. The
 * ordering is fully deterministic (`difficulty DESC, lapses DESC, id ASC`): with
 * ties broken only by difficulty, two equally hard cards would swap places
 * between calls and the `limit` cut would be a coin flip.
 */
export async function hardestCards(
  db: DB,
  userId: string,
  params: HardestCardsParams,
): Promise<HardestCardsResponse> {
  const ranked = db
    .select({
      cardId: card.id,
      deckId: card.deckId,
      // Aliased: drizzle renders a subquery field by its BARE name, so keeping
      // `subject.id` as `"id"` next to `card.id` makes the outer select
      // ambiguous ("column reference id is ambiguous").
      subjectId: sql<string>`${subject.id}`.as('subject_id'),
      // Hard character cut — see FRONT_EXCERPT_CHARS.
      front: sql<string>`left(${card.front}, ${FRONT_EXCERPT_CHARS})`.as('front_excerpt'),
      difficulty: card.difficulty,
      lapses: card.lapses,
      reps: card.reps,
      rank: sql<number>`row_number() over (
        partition by ${subject.id}
        order by ${card.difficulty} desc, ${card.lapses} desc, ${card.id} asc
      )`.as('subject_rank'),
    })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(
      and(
        eq(subject.userId, userId),
        eq(subject.archived, false),
        gt(card.difficulty, 0), // never reviewed → unknown, not easy
        gte(card.reps, MIN_REPS),
      ),
    )
    .as('ranked')

  const rows = await db
    .select({
      cardId: ranked.cardId,
      deckId: ranked.deckId,
      subjectId: ranked.subjectId,
      front: ranked.front,
      difficulty: ranked.difficulty,
      lapses: ranked.lapses,
      reps: ranked.reps,
    })
    .from(ranked)
    .where(lte(ranked.rank, params.limit))
    // Same total order as the partitions: the globally hardest card leads, so a
    // client grouping by subject in encounter order gets a meaningful order too.
    .orderBy(desc(ranked.difficulty), desc(ranked.lapses), asc(ranked.cardId))

  return { minReps: MIN_REPS, limit: params.limit, cards: rows }
}
