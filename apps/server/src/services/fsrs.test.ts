import { describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, generatorParameters, State, type Card as FsrsCard } from 'ts-fsrs'
import { previewAll, schedule, toGrade } from './fsrs'

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
