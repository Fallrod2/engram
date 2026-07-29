import { describe, expect, it } from 'vitest'
import type { ExamReadiness, ReadinessBreakdown, SubjectReadiness } from '@engram/shared'
import {
  pastExamRows,
  readinessDeltaPoints,
  readinessOverviewRows,
  readinessPercent,
  readinessSegments,
  splitExams,
} from './readiness'

const AT = '2026-07-29T10:00:00.000Z'

function breakdown(o: Partial<ReadinessBreakdown> = {}): ReadinessBreakdown {
  return {
    at: AT,
    cardTotal: 10,
    ready: 4,
    notReady: 6,
    neverReviewed: 6,
    readiness: 0.4,
    meanRecall: 0.42,
    ...o,
  }
}

function exam(o: Partial<ExamReadiness> = {}): ExamReadiness {
  return {
    examId: 'e1',
    title: 'Partiel',
    date: '2026-08-12T00:00:00.000Z',
    daysUntil: 14,
    status: 'forecast',
    projectedAt: '2026-08-12T00:00:00.000Z',
    projection: breakdown(),
    ...o,
  }
}

describe('readinessSegments', () => {
  it('splits notReady into decayed and never-reviewed, summing to cardTotal', () => {
    const s = readinessSegments(
      breakdown({ cardTotal: 20, ready: 12, notReady: 8, neverReviewed: 3 }),
    )
    expect(s.map((x) => [x.kind, x.count])).toEqual([
      ['ready', 12],
      ['toReview', 5],
      ['neverReviewed', 3],
    ])
    expect(s.reduce((n, x) => n + x.count, 0)).toBe(20)
  })

  it('keeps the never-reviewed part visible even when it IS the whole gap', () => {
    // The case that motivated the feature: excluding these would read 100 % ready.
    const s = readinessSegments(
      breakdown({ cardTotal: 10, ready: 4, notReady: 6, neverReviewed: 6 }),
    )
    expect(s[1]?.count).toBe(0)
    expect(s[2]?.count).toBe(6)
  })

  it('never divides by zero: a subject with no card has three empty shares', () => {
    const s = readinessSegments(
      breakdown({ cardTotal: 0, ready: 0, notReady: 0, neverReviewed: 0, readiness: null }),
    )
    expect(s.every((x) => x.share === 0 && x.count === 0)).toBe(true)
    expect(s.every((x) => Number.isFinite(x.share))).toBe(true)
  })
})

describe('readinessPercent', () => {
  it('rounds a ratio to whole points', () => {
    expect(readinessPercent(0.357)).toBe(36)
    expect(readinessPercent(1)).toBe(100)
    expect(readinessPercent(0)).toBe(0)
  })

  it('keeps null null — 0 cards out of 0 is not 0 %', () => {
    expect(readinessPercent(null)).toBeNull()
  })
})

describe('readinessDeltaPoints', () => {
  it('reads the projection against today, in points', () => {
    expect(
      readinessDeltaPoints(breakdown({ readiness: 0.62 }), breakdown({ readiness: 0.41 })),
    ).toBe(-21)
  })

  it('is null when either side is unanswerable, never 0', () => {
    expect(readinessDeltaPoints(breakdown({ readiness: null }), breakdown())).toBeNull()
    expect(readinessDeltaPoints(breakdown(), breakdown({ readiness: null }))).toBeNull()
    expect(readinessDeltaPoints(breakdown(), null)).toBeNull()
  })
})

describe('splitExams', () => {
  it('keeps past exams instead of dropping them, and never invents a projection', () => {
    const past = exam({
      examId: 'p',
      daysUntil: -5,
      status: 'past',
      projectedAt: null,
      projection: null,
    })
    const { upcoming, past: kept } = splitExams([past, exam()])
    expect(upcoming.map((e) => e.examId)).toEqual(['e1'])
    expect(kept.map((e) => e.examId)).toEqual(['p'])
    expect(kept[0]?.projection).toBeNull()
  })

  it('orders upcoming soonest-first and past most-recent-first', () => {
    const { upcoming, past } = splitExams([
      exam({ examId: 'far', daysUntil: 20 }),
      exam({ examId: 'old', daysUntil: -20, status: 'past', projection: null }),
      exam({ examId: 'soon', daysUntil: 2 }),
      exam({ examId: 'yesterday', daysUntil: -1, status: 'past', projection: null }),
    ])
    expect(upcoming.map((e) => e.examId)).toEqual(['soon', 'far'])
    expect(past.map((e) => e.examId)).toEqual(['yesterday', 'old'])
  })

  it('treats a no-cards exam as upcoming — it is the one to shout about', () => {
    const empty = exam({ examId: 'empty', status: 'no_cards' })
    expect(splitExams([empty]).upcoming.map((e) => e.examId)).toEqual(['empty'])
  })
})

function subject(id: string, exams: ExamReadiness[], today = breakdown()): SubjectReadiness {
  return { subjectId: id, today, exams }
}

describe('readinessOverviewRows', () => {
  it('flattens every upcoming exam of every subject, soonest first', () => {
    const rows = readinessOverviewRows([
      subject('a', [exam({ examId: 'a1', daysUntil: 14 }), exam({ examId: 'a2', daysUntil: 30 })]),
      subject('b', [exam({ examId: 'b1', daysUntil: 3 })]),
    ])
    expect(rows.map((r) => r.exam.examId)).toEqual(['b1', 'a1', 'a2'])
    expect(rows[0]?.subjectId).toBe('b')
  })

  it('sorts a no-cards exam ahead of a low-but-real one on the same day', () => {
    const rows = readinessOverviewRows([
      subject('a', [
        exam({ examId: 'zero', daysUntil: 7, projection: breakdown({ readiness: 0 }) }),
      ]),
      subject('b', [
        exam({
          examId: 'nocards',
          daysUntil: 7,
          status: 'no_cards',
          projection: breakdown({
            cardTotal: 0,
            ready: 0,
            notReady: 0,
            neverReviewed: 0,
            readiness: null,
          }),
        }),
      ]),
    ])
    expect(rows.map((r) => r.exam.examId)).toEqual(['nocards', 'zero'])
  })

  it('carries the subject baseline so a row can read "today → exam day"', () => {
    const rows = readinessOverviewRows([subject('a', [exam()], breakdown({ readiness: 0.62 }))])
    expect(rows[0]?.today.readiness).toBe(0.62)
  })

  it('is empty when no subject has an upcoming exam', () => {
    expect(
      readinessOverviewRows([
        subject('a', [exam({ daysUntil: -2, status: 'past', projection: null })]),
      ]),
    ).toEqual([])
  })
})

describe('pastExamRows', () => {
  it('collects past exams across subjects, most recent first', () => {
    const rows = pastExamRows([
      subject('a', [exam({ examId: 'old', daysUntil: -12, status: 'past', projection: null })]),
      subject('b', [exam({ examId: 'recent', daysUntil: -1, status: 'past', projection: null })]),
      subject('c', [exam({ examId: 'next' })]),
    ])
    expect(rows.map((r) => r.exam.examId)).toEqual(['recent', 'old'])
  })
})
