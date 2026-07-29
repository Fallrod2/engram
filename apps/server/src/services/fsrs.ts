import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  GenSeedStrategyWithCardId,
  State,
  StrategyMode,
  type FSRS,
  type FSRSParameters,
  type Grade,
  type Card as FsrsCard,
  type RecordLogItem,
  type IPreview,
} from 'ts-fsrs'

/**
 * FSRS-6 parameters for the app. Centralised here so a future "settings" screen
 * can tune them. Defaults kept (request_retention 0.9, maximum_interval 36500,
 * default 21 weights, short-term steps 1m/10m, relearning 10m).
 */
export const FSRS_PARAMS: FSRSParameters = generatorParameters({
  enable_fuzz: true, // prod: slight interval randomisation to smooth the load
})

/**
 * Name of the field carrying the card's primary key INSIDE the ts-fsrs card
 * object. ts-fsrs ignores unknown fields but forwards them (`TypeConvert.card`
 * spreads), which is how the seed strategy below can read it.
 */
export const SEED_CARD_ID_FIELD = 'card_id' as const

/** A ts-fsrs card carrying its DB id, so the fuzz can be seeded from it. */
export type SchedulableCard = FsrsCard & Partial<Record<typeof SEED_CARD_ID_FIELD, string>>

/**
 * Singleton scheduler — stateless and pure; instantiated once at module load.
 *
 * **Fuzz is on AND deterministic** (T-026). Fuzz spreads cards that would
 * otherwise come back on the exact same day, so it stays enabled; but ts-fsrs
 * seeds its PRNG from `DefaultInitSeedStrategy`, i.e.
 * `${review_time_ms}_${reps}_${difficulty * stability}` — a wall-clock value.
 * Every call therefore drew a NEW interval, and `GET /api/cards/:id/preview`
 * (which the rating buttons display) contradicted both itself and the interval
 * `POST /:id/review` would later write.
 *
 * `GenSeedStrategyWithCardId` reseeds from `${card_id + reps}` instead: no
 * wall clock. The fuzz becomes a pure function of (card identity, rep number),
 * exactly like Anki, which seeds its own fuzz from the card id. Consequences:
 *
 *  - two previews of the same card, at any two instants, agree;
 *  - the preview equals what the review writes, provided the base interval is
 *    the same — see `fsrs.test.ts`, `preview_matches_the_review_that_follows`
 *    and the UTC-day-boundary characterisation next to it;
 *  - different cards still get different fuzz, so the load stays spread.
 *
 * A card fed WITHOUT `card_id` falls back to a seed built from `reps` alone:
 * still deterministic, but shared by every card at the same rep. Cards coming
 * from the DB always carry it (`toFsrsCard`).
 */
export const scheduler: FSRS = fsrs(FSRS_PARAMS).useStrategy(
  StrategyMode.SEED,
  GenSeedStrategyWithCardId(SEED_CARD_ID_FIELD),
)

/** Re-type a validated 1..4 literal to the ts-fsrs `Grade` `next` requires. */
export function toGrade(n: 1 | 2 | 3 | 4): Grade {
  return n as Grade
}

/**
 * Apply a review, returning the ts-fsrs `{ card, log }`. Scheduler injectable
 * for tests — an injected one only reproduces the singleton's determinism if it
 * has fuzz off, or the same SEED strategy.
 */
export function schedule(
  card: SchedulableCard,
  grade: Grade,
  reviewedAt: Date,
  sched: FSRS = scheduler,
): RecordLogItem {
  return sched.next(card, reviewedAt, grade)
}

/**
 * Preview the 4 grades (intervals shown in a session). Read-only: it schedules
 * nothing. With the singleton scheduler the four intervals are stable over time
 * and equal to what `schedule()` would write at the same instant.
 */
export function previewAll(
  card: SchedulableCard,
  reviewedAt: Date,
  sched: FSRS = scheduler,
): IPreview {
  return sched.repeat(card, reviewedAt)
}

/** FSRS state of a brand-new card (used by card creation). */
export function freshFsrsCard(now = new Date()): FsrsCard {
  return createEmptyCard(now)
}

/**
 * The recall probability the scheduler itself targets — `request_retention`,
 * 0.9 with the default parameters above. Exposed as the ONE threshold any
 * "is this card known?" question in the app is allowed to use, so no screen
 * invents its own bar. Read from `FSRS_PARAMS`, so tuning the scheduler moves
 * the readiness gauge with it instead of quietly desynchronising the two.
 */
export const TARGET_RETENTION: number = FSRS_PARAMS.request_retention

/**
 * The FSRS columns of a `card` row a recall projection reads. Declared as its
 * own shape (rather than reusing `toFsrsCard`, which needs the whole row) so a
 * caller projecting hundreds of cards can select these ten small columns and
 * leave the Markdown recto/verso in the database.
 */
export interface FsrsMemoryColumns {
  due: Date
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: number
  lastReview: Date | null
}

/**
 * Probability that a card is still recalled at the instant `at` — its FSRS
 * forgetting curve, `R(t,S) = (1 + FACTOR · t/(9·S))^DECAY`, evaluated forward
 * in time. Delegated to `ts-fsrs`' own `get_retrievability`, never
 * re-implemented: the curve's decay/factor derive from the parameter vector, so
 * a hand-rolled copy would drift the day the parameters change.
 *
 * RETURNS `null`, NOT 0, WHEN FSRS HAS NO MEMORY STATE for the card — i.e. it
 * sits in `State.New`, or (a corrupt or restored row) claims another state while
 * carrying no `last_review`. ts-fsrs answers a flat `0` for the New case and
 * THROWS `Invalid date` for the second; neither is usable by a caller that has
 * to tell "never learned" apart from "learned and now forgotten". They are the
 * same number and very different facts, and only the caller knows which of the
 * two its report must name. `null` forces that choice to be made explicitly.
 *
 * `at` before the last review clamps to zero elapsed days (ts-fsrs floors the
 * elapsed count at 0), so a projection can never read as MORE than fully known.
 */
export function projectedRecall(
  m: FsrsMemoryColumns,
  at: Date,
  sched: FSRS = scheduler,
): number | null {
  if (m.state === State.New || m.lastReview === null) return null
  return sched.get_retrievability(
    {
      due: m.due,
      stability: m.stability,
      difficulty: m.difficulty,
      elapsed_days: m.elapsedDays,
      scheduled_days: m.scheduledDays,
      learning_steps: m.learningSteps,
      reps: m.reps,
      lapses: m.lapses,
      state: m.state,
      last_review: m.lastReview,
    },
    at,
    false,
  )
}
