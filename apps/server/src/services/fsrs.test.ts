import { describe, expect, it } from 'vitest'
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  get_fuzz_range,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs'
import {
  FSRS_PARAMS,
  TARGET_RETENTION,
  previewAll,
  projectedRecall,
  schedule,
  toGrade,
  type FsrsMemoryColumns,
  type SchedulableCard,
} from './fsrs'

/** Deterministic scheduler (no fuzz) so exact intervals are reproducible. */
const sched = fsrs(generatorParameters({ enable_fuzz: false }))

const MIN = 60_000
const t0 = new Date('2026-07-12T10:00:00.000Z')

/** A synthetic Review-state card, due in the past. */
function reviewStateCard(due: Date): FsrsCard {
  return {
    due,
    stability: 10,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    state: State.Review,
    last_review: new Date(due.getTime() - 3 * 24 * 60 * MIN),
  }
}

describe('fsrs service (pure)', () => {
  it('fsrs_new_good_goes_learning', () => {
    const rec = schedule(createEmptyCard(t0), toGrade(3), t0, sched)
    expect(rec.card.state).toBe(State.Learning)
    expect(rec.card.reps).toBe(1)
    expect(rec.card.learning_steps).toBe(1)
    expect(rec.card.due.getTime() - t0.getTime()).toBe(10 * MIN)
    expect(rec.card.stability).toBeCloseTo(2.3065, 3)
  })

  it('fsrs_new_again_stays_learning_step0', () => {
    const rec = schedule(createEmptyCard(t0), toGrade(1), t0, sched)
    expect(rec.card.state).toBe(State.Learning)
    expect(rec.card.lapses).toBe(0)
    // Again on a New card keeps it at the first (short) learning step.
    expect(rec.card.due.getTime() - t0.getTime()).toBeLessThan(10 * MIN)
  })

  it('fsrs_new_easy_graduates_fast', () => {
    const good = schedule(createEmptyCard(t0), toGrade(3), t0, sched)
    const easy = schedule(createEmptyCard(t0), toGrade(4), t0, sched)
    expect(easy.card.due.getTime()).toBeGreaterThan(good.card.due.getTime())
  })

  it('fsrs_progression_new_learning_review', () => {
    let card = createEmptyCard(t0)
    let when = t0
    const states: State[] = [card.state]
    const reps: number[] = [card.reps]
    for (let i = 0; i < 6 && card.state !== State.Review; i++) {
      const rec = schedule(card, toGrade(3), when, sched)
      card = rec.card
      when = card.due
      states.push(card.state)
      reps.push(card.reps)
    }
    expect(card.state).toBe(State.Review)
    // States never regress; reps strictly increase.
    expect(states[0]).toBe(State.New)
    for (let i = 1; i < reps.length; i++) expect(reps[i]!).toBeGreaterThan(reps[i - 1]!)
  })

  it('fsrs_lapse_review_again_relearning', () => {
    const due = new Date(t0.getTime() - 5 * 24 * 60 * MIN)
    const rec = schedule(reviewStateCard(due), toGrade(1), t0, sched)
    expect(rec.card.state).toBe(State.Relearning)
    expect(rec.card.lapses).toBe(1)
  })

  it('fsrs_due_moves_forward', () => {
    const due = new Date(t0.getTime() - 5 * 24 * 60 * MIN)
    for (const g of [1, 2, 3, 4] as const) {
      const rec = schedule(reviewStateCard(due), toGrade(g), t0, sched)
      expect(rec.card.due.getTime()).toBeGreaterThan(t0.getTime())
    }
  })

  it('fsrs_previewAll_returns_four_grades', () => {
    const preview = previewAll(createEmptyCard(t0), t0, sched)
    const items = [...preview]
    expect(items).toHaveLength(4)
    const [again, hard, good, easy] = items
    expect(easy!.card.due.getTime()).toBeGreaterThanOrEqual(good!.card.due.getTime())
    expect(good!.card.due.getTime()).toBeGreaterThanOrEqual(hard!.card.due.getTime())
    expect(hard!.card.due.getTime()).toBeGreaterThanOrEqual(again!.card.due.getTime())
  })

  it('fsrs_grade_type_bridge', () => {
    // toGrade(3) is accepted by next (compiles) and produces a valid record.
    const rec = schedule(createEmptyCard(t0), toGrade(3), t0, sched)
    expect(rec.log.rating).toBe(3)
  })

  it('fsrs_scheduler_injectable', () => {
    const a = schedule(createEmptyCard(t0), toGrade(3), t0, sched)
    const b = schedule(createEmptyCard(t0), toGrade(3), t0, sched)
    // No fuzz => the due date is exactly reproducible.
    expect(a.card.due.getTime()).toBe(b.card.due.getTime())
  })
})

/**
 * T-026 — the rating buttons show `previewAll`'s intervals. Before this, the
 * production scheduler seeded its fuzz PRNG from the wall clock, so the same
 * card re-rendered showed 7 j, then 9 j, then 5 j, and none of them was what
 * the review would write. These tests pin the two properties the fix buys, and
 * characterise the one gap it does NOT close.
 *
 * They all run against the DEFAULT (production) scheduler — fuzz ON — because
 * that is precisely what was broken; a no-fuzz scheduler would prove nothing.
 */
describe('fsrs preview determinism (production scheduler, fuzz on)', () => {
  const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]
  /** Mature Review-state card, 10 days since the last review, well past the 2.5 d fuzz floor. */
  function matureCard(id: string): SchedulableCard {
    return {
      card_id: id,
      due: new Date(t0.getTime() - 3 * 24 * 60 * MIN),
      stability: 30,
      difficulty: 5,
      elapsed_days: 10,
      scheduled_days: 10,
      learning_steps: 0,
      reps: 4,
      lapses: 0,
      state: State.Review,
      last_review: new Date(t0.getTime() - 10 * 24 * 60 * MIN),
    }
  }
  const days = (card: SchedulableCard, now: Date): number[] =>
    GRADES.map((g) => previewAll(card, now)[g as 1].card.scheduled_days)

  it('preview_is_stable_across_calls', () => {
    const card = matureCard('card-abc')
    // Three renders of the same card, at three instants of the same day: the
    // client sends a fresh `now` each time, the four numbers must not move.
    const first = days(card, t0)
    expect(days(card, new Date(t0.getTime() + 1000))).toEqual(first)
    expect(days(card, new Date(t0.getTime() + 6 * 60 * MIN))).toEqual(first)
    // Two independent calls at the same instant agree down to the due date.
    const a = previewAll(card, t0)
    const b = previewAll(card, t0)
    for (const g of GRADES) {
      expect(b[g as 1].card.due.getTime()).toBe(a[g as 1].card.due.getTime())
    }
  })

  it('preview_matches_the_review_that_follows', () => {
    // The contract the user cares about: the number on the button is the number
    // written to the DB. Same card, same instant → same interval AND same due.
    const card = matureCard('card-abc')
    const preview = previewAll(card, t0)
    for (const g of GRADES) {
      const applied = schedule(card, g, t0)
      expect(applied.card.scheduled_days).toBe(preview[g as 1].card.scheduled_days)
      expect(applied.card.due.getTime()).toBe(preview[g as 1].card.due.getTime())
    }
  })

  it('preview_is_fuzzed_so_it_is_not_the_raw_fsrs_interval', () => {
    // Characterises the residual difference vs. the textbook FSRS interval: the
    // displayed value is the FUZZED one — inside `get_fuzz_range`, rarely equal
    // to the unfuzzed centre. Fuzz stays on: it is what stops a cohort of cards
    // from all coming back on the same day.
    const raw = sched.repeat(matureCard('card-abc'), t0)
    const shown = new Set<number>()
    for (let i = 0; i < 30; i++) {
      const ivl = previewAll(matureCard(`card-${i}`), t0)[Rating.Good].card.scheduled_days
      const { min_ivl, max_ivl } = get_fuzz_range(
        raw[Rating.Good].card.scheduled_days,
        10,
        FSRS_PARAMS.maximum_interval,
      )
      expect(ivl).toBeGreaterThanOrEqual(min_ivl)
      expect(ivl).toBeLessThanOrEqual(max_ivl)
      shown.add(ivl)
    }
    // Different cards in the same state land on different days (load spreading)
    // and the spread is not centred on the raw interval alone.
    expect(shown.size).toBeGreaterThan(1)
    expect([...shown].some((d) => d !== raw[Rating.Good].card.scheduled_days)).toBe(true)
  })

  it('preview_shifts_only_when_the_elapsed_day_count_does', () => {
    // The gap the fix does NOT close, made explicit: the fuzz is frozen per
    // (card, rep), but the BASE interval still depends on how long the card has
    // actually been waiting. Answering after the UTC day rolls over moves the
    // projection — by the same amount the unfuzzed scheduler moves, i.e. the
    // fuzz contributes nothing to the drift.
    const card = matureCard('card-abc')
    const nextDay = new Date(t0.getTime() + 20 * 60 * MIN) // t0 +20 h, crosses UTC midnight
    const shownNow = previewAll(card, t0)[Rating.Good].card.scheduled_days
    const shownLater = previewAll(card, nextDay)[Rating.Good].card.scheduled_days
    const rawNow = sched.repeat(card, t0)[Rating.Good].card.scheduled_days
    const rawLater = sched.repeat(card, nextDay)[Rating.Good].card.scheduled_days
    expect(shownLater).not.toBe(shownNow)
    expect(shownLater - shownNow).toBe(rawLater - rawNow)
    // Within the same UTC day nothing moves.
    expect(
      previewAll(card, new Date(t0.getTime() + 13 * 60 * MIN))[Rating.Good].card.scheduled_days,
    ).toBe(shownNow)
  })

  it('preview_also_shifts_when_the_rep_count_changes', () => {
    // The SECOND gap the fix does not close, and the reason the header comment
    // no longer promises that the preview always equals the interval written:
    // `reps` is half the seed (`GenSeedStrategyWithCardId` returns
    // `String(card_id + reps)`), so a rating that lands between the preview and
    // the button press — two tabs on the same card — redraws the fuzz.
    const before = matureCard('card-abc') // reps: 4
    const after = { ...before, reps: before.reps + 1 } // the other tab graded it
    const shownBefore = previewAll(before, t0)[Rating.Good].card.scheduled_days
    const shownAfter = previewAll(after, t0)[Rating.Good].card.scheduled_days
    expect(shownAfter).not.toBe(shownBefore)
    // …and the difference is ENTIRELY the fuzz seed: the textbook interval does
    // not read `reps` at all, so the unfuzzed scheduler returns the same day.
    expect(sched.repeat(after, t0)[Rating.Good].card.scheduled_days).toBe(
      sched.repeat(before, t0)[Rating.Good].card.scheduled_days,
    )
    // Which is why this is a limit of the PROMISE, not a defect: in the real
    // race the concurrent rating also rewrites the memory state, and the shown
    // number was stale for reasons that have nothing to do with the fuzz.
    const reallyAfter = schedule(before, Rating.Good as Grade, t0).card
    expect(reallyAfter.stability).not.toBe(before.stability)
    expect(reallyAfter.last_review?.getTime()).not.toBe(before.last_review?.getTime())
  })

  it('preview_without_card_id_is_still_deterministic', () => {
    // Defensive: a card built by hand (not via `toFsrsCard`) has no `card_id`.
    // The seed then falls back to the rep count — degraded (all such cards share
    // a fuzz factor) but never random.
    const anonymous = { ...matureCard('ignored') }
    delete anonymous.card_id
    expect(days(anonymous, new Date(t0.getTime() + 5000))).toEqual(days(anonymous, t0))
  })
})

// ---------------------------------------------------------------------------
describe('projectedRecall (forgetting curve, forward in time)', () => {
  const DAY = 24 * 60 * MIN
  /** A learned card: memory of strength `stability` days, last seen at `seen`. */
  const learned = (stability: number, seen: Date): FsrsMemoryColumns => ({
    due: new Date(seen.getTime() + stability * DAY),
    stability,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: stability,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    state: State.Review,
    lastReview: seen,
  })

  it('threshold_is_the_scheduler_own_request_retention', () => {
    // Not a number invented for the readiness screen: the very same retention
    // every interval FSRS writes is aimed at.
    expect(TARGET_RETENTION).toBe(FSRS_PARAMS.request_retention)
    expect(TARGET_RETENTION).toBe(0.9)
  })

  it('recall_decays_monotonically_with_the_projection_distance', () => {
    const c = learned(10, t0)
    const r = [0, 5, 10, 30, 90].map((d) => projectedRecall(c, new Date(t0.getTime() + d * DAY))!)
    for (let i = 1; i < r.length; i++) expect(r[i]!).toBeLessThan(r[i - 1]!)
    expect(r[0]).toBeCloseTo(1, 10) // no time elapsed → nothing forgotten yet
    expect(r.at(-1)!).toBeGreaterThan(0) // the curve is asymptotic, never exactly 0
  })

  it('recall_at_one_stability_is_the_target_retention', () => {
    // Stability IS "the interval at which recall equals request_retention", so
    // projecting exactly `stability` days out must land on the threshold. This
    // is what makes the >= comparison agree with the scheduler's own due dates.
    const r = projectedRecall(learned(10, t0), new Date(t0.getTime() + 10 * DAY))!
    expect(r).toBeCloseTo(TARGET_RETENTION, 6)
    expect(r).toBeGreaterThanOrEqual(TARGET_RETENTION)
  })

  it('a_stronger_memory_survives_the_same_projection_better', () => {
    const at = new Date(t0.getTime() + 20 * DAY)
    expect(projectedRecall(learned(60, t0), at)!).toBeGreaterThan(
      projectedRecall(learned(6, t0), at)!,
    )
  })

  it('projecting_before_the_last_review_clamps_at_fully_known', () => {
    // Never MORE than 1: elapsed days floor at 0, so a backwards projection
    // cannot manufacture a card that is better than perfectly fresh.
    expect(projectedRecall(learned(10, t0), new Date(t0.getTime() - 30 * DAY))).toBeCloseTo(1, 10)
  })

  it('never_reviewed_card_is_null_not_zero_and_not_one', () => {
    // The distinction the whole readiness metric rests on: "never learned" is
    // not a low probability, it is the ABSENCE of one. ts-fsrs answers a flat 0
    // here; `null` forces the caller to decide what to do with it.
    const fresh: FsrsMemoryColumns = {
      due: t0,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
      lastReview: null,
    }
    expect(projectedRecall(fresh, new Date(t0.getTime() + 10 * DAY))).toBeNull()
  })

  it('a_row_claiming_a_state_without_a_last_review_is_null_not_a_throw', () => {
    // Defensive: ts-fsrs' date_diff THROWS "Invalid date" on a null last_review.
    // A restored backup or a hand-edited row must degrade to "no memory state",
    // never take an analytics endpoint down.
    const corrupt = { ...learned(10, t0), lastReview: null }
    expect(() => projectedRecall(corrupt, t0)).not.toThrow()
    expect(projectedRecall(corrupt, t0)).toBeNull()
  })

  it('learning_and_relearning_states_are_projected_like_any_memory', () => {
    // Only State.New is "no memory": a card mid-learning has a stability and a
    // last review, so it has a curve, and dropping it would silently shrink the
    // denominator of every readiness figure.
    for (const state of [State.Learning, State.Relearning]) {
      const c = { ...learned(2, t0), state }
      expect(projectedRecall(c, new Date(t0.getTime() + DAY))).toBeGreaterThan(0)
    }
  })
})
