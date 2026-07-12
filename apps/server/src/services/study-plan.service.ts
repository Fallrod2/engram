import { and, asc, count, eq, gte, inArray, lt } from 'drizzle-orm'
import type { StudyPlanResponse, StudyTodayResponse } from '@engram/shared'
import type { DB } from '../db/client'
import { card, deck, exam, examSubject, subject } from '../db/schema'
import { localDayDiff, localDayKey, localMidnight } from '../lib/day'
import { ValidationError } from '../http/errors'
import { dueCounts } from './review-queue.service'

/** Days of ramp-up before an exam over which the subject's cards are spread once. */
const EXAM_RAMP_DAYS = 7
/** Hard cap on the window size to bound cost and payload. */
const MAX_WINDOW_DAYS = 366
/** Weight applied to an imminent exam in the "today" priority score. */
const EXAM_PRIORITY_WEIGHT = 10

export interface StudyPlanParams {
  from: string // YYYY-MM-DD (calendar-valid, from localDaySchema)
  to: string // YYYY-MM-DD
  now: Date
  subjectId?: string
}

interface SubjectLoad {
  dueCount: number
  overdueCount: number
  examBoost: number
}
interface DayAcc {
  subjects: Map<string, SubjectLoad>
  exams: { examId: string; title: string; subjectIds: string[] }[]
}

function ensureLoad(acc: DayAcc, subjectId: string): SubjectLoad {
  let load = acc.subjects.get(subjectId)
  if (!load) {
    load = { dueCount: 0, overdueCount: 0, examBoost: 0 }
    acc.subjects.set(subjectId, load)
  }
  return load
}

/** Projected review load per local calendar day over `[from, to]` (inclusive). */
export function studyPlan(db: DB, params: StudyPlanParams): StudyPlanResponse {
  const { from, to, now } = params
  // `from`/`to` are already zero-padded, so string comparison is chronological.
  if (from > to) throw new ValidationError('from must be <= to')

  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  const fromMidnight = localMidnight(fy, fm - 1, fd)
  const toMidnight = localMidnight(ty, tm - 1, td)
  const dayCount = localDayDiff(fromMidnight, toMidnight) + 1
  if (dayCount > MAX_WINDOW_DAYS) {
    throw new ValidationError(`window too large (max ${MAX_WINDOW_DAYS} days)`)
  }
  const endExclusive = localMidnight(ty, tm - 1, td + 1)
  const todayKey = localDayKey(now)

  // Dense day scaffold: one accumulator per calendar day in the window.
  const dayMap = new Map<string, DayAcc>()
  const orderedKeys: string[] = []
  for (let i = 0; i < dayCount; i++) {
    const key = localDayKey(localMidnight(fy, fm - 1, fd + i))
    orderedKeys.push(key)
    dayMap.set(key, { subjects: new Map(), exams: [] })
  }

  // --- 1. Dues (single indexed range scan; overdue folded onto today) -------
  const dueRows = db
    .select({ due: card.due, subjectId: deck.subjectId })
    .from(card)
    .innerJoin(deck, eq(deck.id, card.deckId))
    .innerJoin(subject, eq(subject.id, deck.subjectId))
    .where(
      and(
        eq(subject.archived, false),
        lt(card.due, endExclusive),
        params.subjectId ? eq(deck.subjectId, params.subjectId) : undefined,
      ),
    )
    .all()

  for (const row of dueRows) {
    const dueKey = localDayKey(row.due)
    const overdue = dueKey < todayKey
    const effKey = overdue ? todayKey : dueKey
    const acc = dayMap.get(effKey)
    if (!acc) continue // effKey outside [from, to] (e.g. today before window)
    const load = ensureLoad(acc, row.subjectId)
    load.dueCount += 1
    if (overdue) load.overdueCount += 1
  }

  // --- 2. Exams in the window + ramp reach ----------------------------------
  const endExclusivePlusRamp = localMidnight(ty, tm - 1, td + 1 + EXAM_RAMP_DAYS)
  const examRows = db
    .select()
    .from(exam)
    .where(and(gte(exam.date, fromMidnight), lt(exam.date, endExclusivePlusRamp)))
    .orderBy(asc(exam.date))
    .all()

  if (examRows.length > 0) {
    const examIds = examRows.map((e) => e.id)
    const links = db
      .select({ examId: examSubject.examId, subjectId: examSubject.subjectId })
      .from(examSubject)
      .where(inArray(examSubject.examId, examIds))
      .all()
    const examSubjects = new Map<string, string[]>()
    for (const l of links) {
      const list = examSubjects.get(l.examId)
      if (list) list.push(l.subjectId)
      else examSubjects.set(l.examId, [l.subjectId])
    }

    // Scope size per subject (non-archived), GROUP BY on a non-temporal key.
    const allSubjectIds = [...new Set(links.map((l) => l.subjectId))]
    const scope = new Map<string, number>()
    if (allSubjectIds.length > 0) {
      const scopeRows = db
        .select({ subjectId: deck.subjectId, n: count(card.id) })
        .from(card)
        .innerJoin(deck, eq(deck.id, card.deckId))
        .innerJoin(subject, eq(subject.id, deck.subjectId))
        .where(and(eq(subject.archived, false), inArray(deck.subjectId, allSubjectIds)))
        .groupBy(deck.subjectId)
        .all()
      for (const r of scopeRows) scope.set(r.subjectId, r.n)
    }

    for (const e of examRows) {
      const ed = e.date
      const examKey = localDayKey(ed)
      const fullSubjectIds = examSubjects.get(e.id) ?? []

      // Boost: spread each subject's scope over the 7 days before the exam.
      const boostSubjects = params.subjectId
        ? fullSubjectIds.filter((s) => s === params.subjectId)
        : fullSubjectIds
      for (const s of boostSubjects) {
        const n = scope.get(s) ?? 0
        if (n === 0) continue // absent/archived subject → no boost
        const perDay = Math.ceil(n / EXAM_RAMP_DAYS)
        for (let k = 1; k <= EXAM_RAMP_DAYS; k++) {
          const rampKey = localDayKey(
            localMidnight(ed.getFullYear(), ed.getMonth(), ed.getDate() - k),
          )
          if (rampKey < from || rampKey > to || rampKey < todayKey) continue
          const acc = dayMap.get(rampKey)
          if (!acc) continue
          ensureLoad(acc, s).examBoost += perDay
        }
      }

      // Marker: only if the exam day itself is inside the window.
      if (examKey >= from && examKey <= to) {
        const acc = dayMap.get(examKey)
        if (acc) acc.exams.push({ examId: e.id, title: e.title, subjectIds: fullSubjectIds })
      }
    }
  }

  // --- 3. Assemble dense response -------------------------------------------
  const days = orderedKeys.map((key) => {
    const acc = dayMap.get(key)!
    const bySubject = [...acc.subjects.entries()]
      .filter(([, l]) => l.dueCount > 0 || l.examBoost > 0 || l.overdueCount > 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([subjectId, l]) => ({
        subjectId,
        dueCount: l.dueCount,
        overdueCount: l.overdueCount,
        examBoost: l.examBoost,
      }))
    const dueCount = bySubject.reduce((sum, s) => sum + s.dueCount, 0)
    const overdueCount = bySubject.reduce((sum, s) => sum + s.overdueCount, 0)
    const examBoost = bySubject.reduce((sum, s) => sum + s.examBoost, 0)
    return {
      date: key,
      isToday: key === todayKey,
      dueCount,
      overdueCount,
      examBoost,
      total: dueCount + examBoost,
      bySubject,
      exams: acc.exams,
    }
  })

  return { now: now.toISOString(), from, to, days }
}

/** Prioritized "what to review today", crossing dues with exam proximity. */
export function studyToday(db: DB, now: Date): StudyTodayResponse {
  const counts = dueCounts(db, now)
  const todayMidnight = localMidnight(now.getFullYear(), now.getMonth(), now.getDate())
  // Cards due strictly before local midnight today = the overdue backlog.
  const overdueCount = dueCounts(db, new Date(todayMidnight.getTime() - 1)).total

  // Next upcoming exam per subject, batched into ONE query (no N+1).
  const subjectIds = counts.bySubject.map((b) => b.subjectId)
  const nextExamBySubject = new Map<string, { examId: string; title: string; date: Date }>()
  if (subjectIds.length > 0) {
    const rows = db
      .select({
        subjectId: examSubject.subjectId,
        examId: exam.id,
        title: exam.title,
        date: exam.date,
      })
      .from(exam)
      .innerJoin(examSubject, eq(examSubject.examId, exam.id))
      .where(and(inArray(examSubject.subjectId, subjectIds), gte(exam.date, todayMidnight)))
      .orderBy(asc(exam.date))
      .all()
    for (const r of rows) {
      if (!nextExamBySubject.has(r.subjectId)) {
        nextExamBySubject.set(r.subjectId, { examId: r.examId, title: r.title, date: r.date })
      }
    }
  }

  const subjects = counts.bySubject
    .map((b) => {
      const ex = nextExamBySubject.get(b.subjectId)
      const nextExam = ex
        ? {
            examId: ex.examId,
            title: ex.title,
            date: ex.date.toISOString(),
            daysUntil: localDayDiff(todayMidnight, ex.date),
          }
        : null
      const examWeight =
        nextExam && nextExam.daysUntil <= EXAM_RAMP_DAYS
          ? (EXAM_RAMP_DAYS - nextExam.daysUntil + 1) * EXAM_PRIORITY_WEIGHT
          : 0
      return {
        subjectId: b.subjectId,
        dueCount: b.dueCount,
        nextExam,
        priority: b.dueCount + examWeight,
      }
    })
    .filter(
      (s) => s.dueCount > 0 || (s.nextExam !== null && s.nextExam.daysUntil <= EXAM_RAMP_DAYS),
    )
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.dueCount - a.dueCount ||
        (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0),
    )

  return { now: now.toISOString(), total: counts.total, overdueCount, subjects }
}
