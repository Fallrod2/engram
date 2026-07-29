import { and, countDistinct, count, eq, gte, lt } from 'drizzle-orm'
import { State } from 'ts-fsrs'
import {
  STUDY_DAILY_GOAL_DEFAULT,
  STUDY_NEW_CARDS_PER_DAY_DEFAULT,
  studySettingsSchema,
  type StudyPaceToday,
  type StudySettings,
  type StudySettingsResponse,
  type UpdateStudySettings,
} from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { appSettings, reviewLog } from '../db/schema'
import { localDayBounds, localDayKey } from '../lib/day'

/**
 * Daily pacing: the new-card limit (a hard constraint) and the daily goal (pure
 * display). See `studySettingsSchema` in `@engram/shared` for why the two must
 * never be conflated.
 *
 * WHERE IT IS STORED, AND WHY THERE IS NO MIGRATION. Under the `'study'` key of
 * `app_settings`, the per-user non-secret k/v store — the same place the AI
 * config lives, with the same tolerant read. That table is already scoped by the
 * composite PK `(user_id, key)`, already carries its RLS policy (migration 0006)
 * and is already purged by the account-delete path (`admin.service.ts`), so a
 * preference lands there with zero new DDL. The alternatives were both worse:
 *
 *  - two columns on `user_profile` — that table is the IAM record (role, status,
 *    is_demo, DB-enforced admin/demo invariants), read on EVERY authenticated
 *    request by the profile middleware and written by the admin console. Putting
 *    a study preference in it means the admin CRUD surface, its audit entries and
 *    the identity probe all have to learn about a setting none of them is about.
 *  - a dedicated `study_settings` table — one row per user, one key, one reader.
 *    It buys nothing over the k/v store (nothing aggregates or joins on these two
 *    numbers; they are read one user at a time on the queue path) and costs a
 *    migration, i.e. exactly the class of hazard migration 0010 documents at
 *    length: DDL that must apply cleanly on PGlite, on bare Postgres and on the
 *    cloud, where roles and data differ.
 *
 * NO DEMO ALIAS, deliberately — unlike `ai-config.service.ts`, which reads the
 * admin's config for the demo account because the demo needs a working API key.
 * Pacing is not a capability, it is a preference: aliasing it would let Alex
 * setting `newCardsPerDay: 0` empty the public demo's queue of new cards.
 */

/** The single `app_settings` key holding the pacing blob. */
export const STUDY_KEY = 'study'

/**
 * Coded defaults, applied to every account that has never chosen (i.e. every
 * account existing before this feature — no backfill is written anywhere).
 *
 * 20 new cards/day. This is a deliberate, non-neutral number:
 *  - a new card is not one review, it is three to five over its first week
 *    (learning steps, then the first two intervals), so 20/day settles into a
 *    steady state around 80–120 reviews/day — roughly 15–25 min at 8–10 s a
 *    card. That is a daily habit a student actually keeps.
 *  - 50 makes day three unbearable, which is precisely the failure this setting
 *    exists to prevent; 10 is too timid for someone importing a course before an
 *    exam and would feel like the app is withholding their own content.
 *  - it is NOT "unlimited". A default that constrains nothing leaves the setting
 *    inert for everyone who never opens the onboarding step, and the guard-rail
 *    would then protect only the people who already knew they needed it.
 *  This matches the value the spaced-repetition tools converged on (Anki ships
 *  20), which is the closest thing to field evidence available here.
 *
 * 30 reviews as the daily goal: a FLOOR to clear on a bad day (~5 minutes), not
 * a target for a good one — a goal one fails on a busy evening kills the streak
 * it was meant to protect.
 */
export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  newCardsPerDay: STUDY_NEW_CARDS_PER_DAY_DEFAULT,
  dailyGoal: STUDY_DAILY_GOAL_DEFAULT,
}

const newCardsPerDayField = studySettingsSchema.shape.newCardsPerDay
const dailyGoalField = studySettingsSchema.shape.dailyGoal

/**
 * Coerce a stored (possibly partial, legacy or hand-edited) blob into full
 * settings, FIELD BY FIELD — same tolerance as `ai-config.service.ts`. A single
 * corrupt value falls back to its own default instead of discarding the other
 * one, and a blob that is not an object at all reads as the defaults. This path
 * never throws: a bad row must not be able to break the review queue.
 */
export function coerceStudySettings(raw: unknown): StudySettings {
  const base: StudySettings = { ...DEFAULT_STUDY_SETTINGS }
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const n = newCardsPerDayField.safeParse(r.newCardsPerDay)
  if (n.success) base.newCardsPerDay = n.data
  const g = dailyGoalField.safeParse(r.dailyGoal)
  if (g.success) base.dailyGoal = g.data
  return base
}

/** The caller's pacing settings — the coded defaults when they never chose. */
export async function readStudySettings(db: DB | Tx, userId: string): Promise<StudySettings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, STUDY_KEY)))
  return coerceStudySettings(row?.value)
}

async function writeStudySettings(db: DB, userId: string, settings: StudySettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ userId, key: STUDY_KEY, value: settings })
    .onConflictDoUpdate({
      target: [appSettings.userId, appSettings.key],
      set: { value: settings, updatedAt: new Date() },
    })
}

/**
 * How many DISTINCT cards left the `New` state during `now`'s local day.
 *
 * THE DEFINITION, and why it is this one. `review_log.state` is documented as
 * the state BEFORE the review (it is what ts-fsrs `buildLog` records), so a row
 * with `state = New` is the physical trace of "this card was introduced". It is
 * the only candidate that survives the three awkward cases:
 *
 *  - revealed then abandoned without grading → no row is ever written, and the
 *    card is still `New`, so it is not counted and comes back. Counting at
 *    "leaves the queue" would have burnt a slot for a card nobody answered.
 *  - graded `Again` on the first sitting → the card goes to `Learning` and comes
 *    back within minutes; the second row carries `state = Learning`, so the card
 *    is counted exactly once however many times it is seen today.
 *  - undone with `U` → `undoReview` HARD DELETES the compensated row (the single
 *    documented exception to review_log being append-only), so the count walks
 *    back on its own. A counter column or an `introduced_at` stamp on `card`
 *    would each need their own compensation, and would drift the first time one
 *    was forgotten.
 *
 * `countDistinct` rather than `count`: it makes the number mean "cards
 * introduced" under any history, including a restored backup that replays logs.
 *
 * The day window is `localDayBounds(now)` — two instants computed from local
 * date components in JS and compared in SQL, never a SQL date truncation
 * (`lib/day.ts`). Half-open, so a review landing exactly on local midnight
 * belongs to the day that starts there.
 */
export async function countNewCardsIntroduced(db: DB, userId: string, now: Date): Promise<number> {
  const { start, end } = localDayBounds(now)
  const [row] = await db
    .select({ n: countDistinct(reviewLog.cardId) })
    .from(reviewLog)
    .where(
      and(
        eq(reviewLog.userId, userId),
        eq(reviewLog.state, State.New),
        gte(reviewLog.review, start),
        lt(reviewLog.review, end),
      ),
    )
  return row?.n ?? 0
}

/** Every review logged during `now`'s local day — the `dailyGoal` numerator. */
export async function countReviewsDone(db: DB, userId: string, now: Date): Promise<number> {
  const { start, end } = localDayBounds(now)
  const [row] = await db
    .select({ n: count() })
    .from(reviewLog)
    .where(
      and(eq(reviewLog.userId, userId), gte(reviewLog.review, start), lt(reviewLog.review, end)),
    )
  return row?.n ?? 0
}

export interface NewCardBudget {
  limit: number
  introduced: number
  remaining: number
}

/**
 * The new-card budget left for `now`'s local day. `remaining` is clamped at 0 so
 * lowering the setting after studying reads as "done for today" rather than as a
 * negative allowance.
 *
 * It is GLOBAL to the account, not per deck: the point is the total load the
 * following days will carry, and that total does not care which deck the cards
 * came from. So filtering the queue by deck does not hand out a fresh budget.
 */
export async function newCardBudget(db: DB, userId: string, now: Date): Promise<NewCardBudget> {
  const [settings, introduced] = await Promise.all([
    readStudySettings(db, userId),
    countNewCardsIntroduced(db, userId, now),
  ])
  const limit = settings.newCardsPerDay
  return { limit, introduced, remaining: Math.max(0, limit - introduced) }
}

async function paceToday(
  db: DB,
  userId: string,
  settings: StudySettings,
  now: Date,
): Promise<StudyPaceToday> {
  const [introduced, reviewsDone] = await Promise.all([
    countNewCardsIntroduced(db, userId, now),
    countReviewsDone(db, userId, now),
  ])
  return {
    day: localDayKey(now),
    newCardsIntroduced: introduced,
    newCardsRemaining: Math.max(0, settings.newCardsPerDay - introduced),
    reviewsDone,
  }
}

export async function getStudySettings(
  db: DB,
  userId: string,
  now: Date,
): Promise<StudySettingsResponse> {
  const settings = await readStudySettings(db, userId)
  return { settings, today: await paceToday(db, userId, settings, now) }
}

/**
 * Merge a partial patch over the current settings and persist the FULL blob, so
 * a stored row is always complete and `coerceStudySettings` never has to guess.
 * Re-validated through the schema before the write — the route already rejects
 * out-of-range values, this is the anti-drift net for any future caller.
 */
export async function updateStudySettings(
  db: DB,
  userId: string,
  patch: UpdateStudySettings,
  now: Date,
): Promise<StudySettingsResponse> {
  const current = await readStudySettings(db, userId)
  const next = studySettingsSchema.parse({
    newCardsPerDay: patch.newCardsPerDay ?? current.newCardsPerDay,
    dailyGoal: patch.dailyGoal ?? current.dailyGoal,
  })
  await writeStudySettings(db, userId, next)
  return { settings: next, today: await paceToday(db, userId, next, now) }
}
