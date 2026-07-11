import {
  fsrs,
  generatorParameters,
  createEmptyCard,
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

/** Singleton scheduler — stateless and pure; instantiated once at module load. */
export const scheduler: FSRS = fsrs(FSRS_PARAMS)

/** Re-type a validated 1..4 literal to the ts-fsrs `Grade` `next` requires. */
export function toGrade(n: 1 | 2 | 3 | 4): Grade {
  return n as Grade
}

/** Apply a review, returning the ts-fsrs `{ card, log }`. Scheduler injectable for tests. */
export function schedule(
  card: FsrsCard,
  grade: Grade,
  reviewedAt: Date,
  sched: FSRS = scheduler,
): RecordLogItem {
  return sched.next(card, reviewedAt, grade)
}

/** Preview the 4 grades (intervals shown in a session). Scheduler injectable for tests. */
export function previewAll(card: FsrsCard, reviewedAt: Date, sched: FSRS = scheduler): IPreview {
  return sched.repeat(card, reviewedAt)
}

/** FSRS state of a brand-new card (used by card creation). */
export function freshFsrsCard(now = new Date()): FsrsCard {
  return createEmptyCard(now)
}
