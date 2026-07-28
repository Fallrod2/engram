import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  GenSeedStrategyWithCardId,
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
