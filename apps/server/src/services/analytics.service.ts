import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm'
import type {
  DeckSuccessResponse,
  ExamReadinessResponse,
  ExamReadinessStatus,
  HardestCardsResponse,
  HeatmapResponse,
  ReadinessBreakdown,
  RetentionResponse,
  ReviewVolumeResponse,
  StreaksResponse,
  StudyTimeResponse,
} from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, reviewLog, subject } from '../db/schema'
import { localDayDiff, localDayKey, localMidnight, localWeekStart } from '../lib/day'
import { ValidationError } from '../http/errors'
import { TARGET_RETENTION, projectedRecall, type FsrsMemoryColumns } from './fsrs'

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
/**
 * How far back a past exam is still reported by `examReadiness`. A partial you
 * sat yesterday is still worth seeing on the subject's page ("where did I stand
 * when I walked in"); one from eighteen months ago is archive, and returning
 * every exam ever created would grow the payload without bound. 30 days is one
 * exam period.
 */
export const PAST_EXAM_WINDOW_DAYS = 30

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

// --- Per-subject narrowing -------------------------------------------------
//
// See `analyticsSubjectShape` in `@engram/shared` for the semantics the whole
// family shares. Two mechanisms, because the endpoints read two different
// tables; both are a WHERE clause, never a second code path.

/**
 * Narrow a `review_log` scan to one subject WITHOUT reshaping its query.
 *
 * The three series endpoints deliberately scan `review_log` alone — the row
 * carries its own `user_id` precisely so they need no join (see the table's
 * comment). Rewriting each of them into a three-table join for the subject case
 * would fork every one of them in two. Instead the subject becomes an extra
 * predicate: "this review's card currently sits under subject X", expressed as a
 * semi-join on the card ids of the subject's decks. `review_log_card_idx` and
 * `card_deck_idx` both cover it, and Postgres plans it as a hash semi-join — one
 * query, whatever the card count.
 *
 * NO `subject` JOIN, so no `archived` predicate and no ownership predicate here:
 * the caller's `review_log.user_id = userId` already fences the scan, and a
 * `subjectId` belonging to somebody else simply matches no card of theirs.
 *
 * KNOWN AND ACCEPTED: this reads the CURRENT shape of the tree. A card moved to
 * another deck, or a deck moved to another subject, carries its whole review
 * history with it. Attribution is by where the card lives now, not by where it
 * lived on the day of each review — the log stores no subject, and back-dating
 * it would mean versioning the tree. Same trade-off the retention query has
 * always made.
 */
function reviewsOfSubject(db: DB, subjectId: string | undefined): SQL | undefined {
  if (subjectId === undefined) return undefined
  return inArray(
    reviewLog.cardId,
    db
      .select({ id: card.id })
      .from(card)
      .innerJoin(deck, eq(deck.id, card.deckId))
      .where(eq(deck.subjectId, subjectId)),
  )
}

/**
 * The subject predicate of the endpoints that already join `subject`: one named
 * subject whatever its `archived` flag, or every non-archived one. Archiving
 * governs which subjects show up in a list nobody asked for; it does not erase
 * the history of one asked for by id.
 */
function subjectScope(userId: string, subjectId: string | undefined): SQL | undefined {
  return and(
    eq(subject.userId, userId),
    subjectId !== undefined ? eq(subject.id, subjectId) : eq(subject.archived, false),
  )
}

// --- Endpoints -------------------------------------------------------------

export interface SeriesParams {
  now: Date
  from?: string
  to?: string
  /** Optional per-subject narrowing — see `reviewsOfSubject`. */
  subjectId?: string
}
export interface GranularSeriesParams extends SeriesParams {
  granularity: Granularity
}
export interface RateParams {
  from?: string
  to?: string
  /** Optional per-subject narrowing — see `subjectScope`. */
  subjectId?: string
}
export interface HardestCardsParams {
  /** Cards kept PER SUBJECT (bounded 1..20 by `hardestCardsQuerySchema`). */
  limit: number
  /** Optional per-subject narrowing — see `subjectScope`. */
  subjectId?: string
}
export interface ExamReadinessParams {
  now: Date
  /** Optional per-subject narrowing — see `subjectScope`. */
  subjectId?: string
}

/**
 * Reviews per local calendar day over a window — a dense contribution-graph
 * feed. One indexed range scan on `review`, no join (retrospective: the past is
 * immutable, archived state is not applied). Manual(0) excluded.
 *
 * With `subjectId`, the same scan narrowed to that subject's cards — "when did I
 * work on THIS", which is a real question about a subject, unlike a streak.
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
        reviewsOfSubject(db, params.subjectId),
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
 * `subjectId` narrows it to one subject ("how much of my time went here").
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
        reviewsOfSubject(db, params.subjectId),
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
 * contain it. `subjectId` narrows it to one subject ("how did THIS one go").
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
        reviewsOfSubject(db, params.subjectId),
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
 * Archived subjects excluded (present-tense view), unless one is named by
 * `subjectId` — which then returns that subject alone. Single aggregation query.
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
    .where(subjectScope(userId, params.subjectId))
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
 * Decks of archived subjects excluded, unless `subjectId` names one — which then
 * returns the decks of that subject alone. Single aggregation query.
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
    .where(subjectScope(userId, params.subjectId))
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
 *
 * With `subjectId` there is a single partition, so `limit` becomes the total
 * count returned and the window function degenerates harmlessly to a plain
 * ordered top-N.
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
        subjectScope(userId, params.subjectId),
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

// --- Exam readiness --------------------------------------------------------

/**
 * Readiness of one set of cards at one instant: the share whose FSRS forgetting
 * curve is still above `TARGET_RETENTION` at `at`.
 *
 * NEVER-REVIEWED CARDS ARE COUNTED AS NOT READY — the whole point of the metric.
 * `projectedRecall` returns `null` for them (FSRS holds no memory state), and
 * this function reads that `null` as "0 % recalled": the card enters
 * `cardTotal`, it never enters `ready`, and it pulls `meanRecall` down like the
 * zero it is. Dropping them instead would let a subject of 100 cards, 90 of them
 * untouched, report "100 % ready" off the 10 that were studied — an encouraging
 * number, and the most dangerous thing this screen could say before an exam.
 * They are also counted on their own (`neverReviewed`) so the UI can name them
 * ("78 % prêt, dont 40 cartes jamais vues") instead of just looking pessimistic.
 *
 * `readiness` and `meanRecall` are BOTH null on an empty set: 0 ready out of 0
 * cards is not 100 %, and it is not 0 % either — it is undefined, and saying so
 * is what lets the UI show "aucune carte" rather than a gauge at either end.
 *
 * Pure and in-memory: the caller loads a subject's cards ONCE and calls this per
 * exam, so N exams cost N passes over an array, never N queries.
 */
function breakdown(cards: FsrsMemoryColumns[], at: Date): ReadinessBreakdown {
  let ready = 0
  let neverReviewed = 0
  let recallSum = 0
  for (const c of cards) {
    const r = projectedRecall(c, at)
    if (r === null) {
      neverReviewed += 1 // contributes 0 to recallSum, and never to `ready`
      continue
    }
    recallSum += r
    if (r >= TARGET_RETENTION) ready += 1
  }
  const cardTotal = cards.length
  return {
    at: at.toISOString(),
    cardTotal,
    ready,
    notReady: cardTotal - ready,
    neverReviewed,
    readiness: cardTotal > 0 ? ready / cardTotal : null,
    meanRecall: cardTotal > 0 ? recallSum / cardTotal : null,
  }
}

/**
 * "Will I know this on the day?" — per subject, per exam.
 *
 * THE DEFINITION (arbitrated, not re-opened here): the probability of recall AT
 * THE DATE OF THE EXAM. Every card of the subject is projected forward along its
 * own FSRS forgetting curve to the exam day, and the answer is how many land at
 * or above the retention the scheduler already targets. It forecasts MEMORY, and
 * deliberately measures no effort: review counts, streaks and study time all
 * already have their own endpoints, and none of them answers this question — one
 * can review a subject every day and still walk in having forgotten it.
 *
 * THE DAY CONVENTION. An exam is a DAY, not an instant (`exams.service.ts`
 * stores it at local midnight). The projection instant is that local midnight,
 * recomputed from the row's local components so it holds whatever wrote the row
 * — the same instant `study-plan` and `study-today` already mean by "the exam" —
 * FLOORED AT `now`, so an exam happening today is never "predicted" backwards
 * into a morning that has already passed. `daysUntil` is `localDayDiff`, so a
 * DST day still counts as one day, exactly like everywhere else.
 *
 * THE THREE DEGENERATE CASES, each answered rather than omitted:
 *  - no exam at all → `exams: []`, but `today` is still computed, so the subject
 *    page says "12 cartes, 4 jamais vues, aucun examen programmé".
 *  - exam already past → the entry is returned with `status: 'past'` and NO
 *    projection (`null`): a forecast for a date that has been and gone is a
 *    contradiction, and computing one "at the exam date" from cards reviewed
 *    since would silently describe a past self.
 *  - subject with ZERO cards → `status: 'no_cards'`, projection present and
 *    fully zeroed with `readiness: null`. This is the case the app used to
 *    answer with nothing at all: an exam three weeks out on an empty subject.
 *
 * COST: exactly THREE queries, whatever the size of the account — the subjects,
 * their cards (FSRS columns only, no Markdown), and their exams. The projection
 * itself is arithmetic over arrays in memory, so a subject of several hundred
 * cards is one row set, never one query per card.
 */
export async function examReadiness(
  db: DB,
  userId: string,
  params: ExamReadinessParams,
): Promise<ExamReadinessResponse> {
  const { now } = params
  const todayMidnight = localMidnight(now.getFullYear(), now.getMonth(), now.getDate())
  const pastCutoff = localMidnight(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - PAST_EXAM_WINDOW_DAYS,
  )
  const envelope = {
    now: now.toISOString(),
    threshold: TARGET_RETENTION,
    pastWindowDays: PAST_EXAM_WINDOW_DAYS,
  }

  // --- 1. The subjects in scope --------------------------------------------
  const subjectRows = await db
    .select({ id: subject.id })
    .from(subject)
    .where(subjectScope(userId, params.subjectId))
    .orderBy(asc(subject.position), asc(subject.createdAt))
  if (subjectRows.length === 0) return { ...envelope, subjects: [] }
  const subjectIds = subjectRows.map((s) => s.id)

  // --- 2. Their cards, FSRS columns only (never `front`/`back`) -------------
  const cardRows = await db
    .select({
      subjectId: deck.subjectId,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      learningSteps: card.learningSteps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      lastReview: card.lastReview,
    })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .where(and(eq(card.userId, userId), inArray(deck.subjectId, subjectIds)))

  const cardsBySubject = new Map<string, FsrsMemoryColumns[]>()
  for (const id of subjectIds) cardsBySubject.set(id, [])
  for (const row of cardRows) {
    const { subjectId, ...memory } = row
    cardsBySubject.get(subjectId)?.push(memory)
  }

  // --- 3. Their exams (future, plus a bounded tail of past ones) ------------
  const examRows = await db
    .select({
      subjectId: examSubject.subjectId,
      examId: exam.id,
      title: exam.title,
      date: exam.date,
      createdAt: exam.createdAt,
    })
    .from(exam)
    .innerJoin(examSubject, eq(examSubject.examId, exam.id))
    .where(
      and(
        eq(exam.userId, userId),
        inArray(examSubject.subjectId, subjectIds),
        gte(exam.date, pastCutoff),
      ),
    )
    .orderBy(asc(exam.date), asc(exam.createdAt))

  const examsBySubject = new Map<string, typeof examRows>()
  for (const row of examRows) {
    const list = examsBySubject.get(row.subjectId)
    if (list) list.push(row)
    else examsBySubject.set(row.subjectId, [row])
  }

  // --- 4. Project ----------------------------------------------------------
  const subjects = subjectRows.map((s) => {
    const cards = cardsBySubject.get(s.id) ?? []
    const exams = (examsBySubject.get(s.id) ?? []).map((e) => {
      // Local midnight of the exam DAY, recomputed from the row's own local
      // components so the convention holds whatever wrote the row.
      const examDay = localMidnight(e.date.getFullYear(), e.date.getMonth(), e.date.getDate())
      const daysUntil = localDayDiff(todayMidnight, examDay)
      const past = daysUntil < 0
      const status: ExamReadinessStatus = past
        ? 'past'
        : cards.length === 0
          ? 'no_cards'
          : 'forecast'
      // Floored at `now`: a same-day exam is projected from this instant, never
      // from a midnight that has already gone by.
      const projectAt = new Date(Math.max(examDay.getTime(), now.getTime()))
      return {
        examId: e.examId,
        title: e.title,
        date: examDay.toISOString(),
        daysUntil,
        status,
        projectedAt: past ? null : projectAt.toISOString(),
        projection: past ? null : breakdown(cards, projectAt),
      }
    })
    return { subjectId: s.id, today: breakdown(cards, now), exams }
  })

  return { ...envelope, subjects }
}
