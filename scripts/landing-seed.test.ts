import { describe, expect, it } from 'vitest'
import { backupSchema, parseQcm } from '@engram/shared'
import { buildSeedBackup } from './landing-seed'

/**
 * The landing captures are generated from this dataset and then shipped as
 * static images: a regression here is invisible until somebody looks at a
 * screenshot on the public site. So the properties the captures DEPEND ON are
 * pinned here rather than trusted.
 *
 * The clock is frozen at a mid-afternoon instant so the `today` bucket is
 * unambiguously in the past (a card released at 00:01 is due at 15:00) and the
 * `later` bucket unambiguously in the future.
 */
const NOW = new Date('2026-07-29T15:00:00+02:00')
const DAY = 86_400_000

function build() {
  return buildSeedBackup(NOW)
}

function localMidnight(d: Date): number {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  return m.getTime()
}

/** Due split exactly as `dueCounts` computes it (review-queue.service.ts). */
function dueSplit(backup: ReturnType<typeof build>) {
  const midnight = localMidnight(NOW)
  const now = NOW.getTime()
  const deckSubject = new Map(backup.tables.deck.map((d) => [d.id, d.subjectId]))
  const bySubject = new Map<string, { overdue: number; today: number }>()
  let overdue = 0
  let today = 0
  for (const c of backup.tables.card) {
    const due = new Date(c.due).getTime()
    if (due > now) continue
    const subjectId = deckSubject.get(c.deckId)!
    const bucket = bySubject.get(subjectId) ?? { overdue: 0, today: 0 }
    if (due < midnight) {
      bucket.overdue += 1
      overdue += 1
    } else {
      bucket.today += 1
      today += 1
    }
    bySubject.set(subjectId, bucket)
  }
  return { overdue, today, bySubject }
}

describe('landing seed — shape', () => {
  it('is a valid v1 backup payload', () => {
    expect(backupSchema.safeParse(build()).success).toBe(true)
  })

  it('is deterministic for a given clock', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })

  it('is referentially closed (no orphan deck, card, log, generation or exam link)', () => {
    const b = build()
    const subjects = new Set(b.tables.subject.map((s) => s.id))
    const decks = new Set(b.tables.deck.map((d) => d.id))
    const cards = new Set(b.tables.card.map((c) => c.id))
    const notes = new Set(b.tables.note.map((n) => n.id))
    const exams = new Set(b.tables.exam.map((e) => e.id))

    expect(b.tables.deck.every((d) => subjects.has(d.subjectId))).toBe(true)
    expect(b.tables.card.every((c) => decks.has(c.deckId))).toBe(true)
    expect(b.tables.reviewLog.every((l) => cards.has(l.cardId))).toBe(true)
    expect(b.tables.note.every((n) => n.subjectId === null || subjects.has(n.subjectId))).toBe(true)
    expect(
      b.tables.generation.every(
        (g) => notes.has(g.noteId) && (g.deckId === null || decks.has(g.deckId)),
      ),
    ).toBe(true)
    // A generation item that claims a cardId must claim one that exists — that
    // link is what the import screen's history rows resolve.
    expect(
      b.tables.generation.every((g) =>
        g.items.every((i) => i.cardId === undefined || cards.has(i.cardId)),
      ),
    ).toBe(true)
    expect(
      b.tables.examSubject.every((x) => exams.has(x.examId) && subjects.has(x.subjectId)),
    ).toBe(true)
  })

  it('never repeats a question', () => {
    const fronts = build().tables.card.map((c) => c.front)
    expect(new Set(fronts).size).toBe(fronts.length)
  })
})

describe('landing seed — the numbers the captures print', () => {
  it('gives Théorie des langages a 12+5 split (the backlog badge the sidebar renders)', () => {
    // This is THE reason the dataset declares due dates per card instead of
    // scattering them: `DueCount` only prints two halves when both are non-zero.
    const split = dueSplit(build()).bySubject.get('sub-tdl')
    expect(split).toEqual({ overdue: 12, today: 5 })
  })

  it('leaves one subject with no backlog at all, so the split reads as a signal', () => {
    const split = dueSplit(build()).bySubject.get('sub-anglais')
    expect(split?.overdue).toBe(0)
    expect(split?.today).toBeGreaterThan(0)
  })

  it('has a substantial but plausible queue, backlog included', () => {
    const { overdue, today } = dueSplit(build())
    expect(overdue).toBe(21)
    expect(overdue + today).toBe(44)
  })

  it('keeps cards that are NOT due, so the planning forecast has something to project', () => {
    const b = build()
    const later = b.tables.card.filter((c) => new Date(c.due).getTime() > NOW.getTime())
    expect(later.length).toBeGreaterThanOrEqual(20)
  })
})

describe('landing seed — the review capture', () => {
  it('pins exactly one card as the oldest due, so the revealed card is predictable', () => {
    const b = build()
    const sorted = [...b.tables.card].sort(
      (a, z) =>
        new Date(a.due).getTime() - new Date(z.due).getTime() ||
        new Date(a.createdAt).getTime() - new Date(z.createdAt).getTime(),
    )
    const [head, second] = sorted
    expect(head!.front).toContain('lemme de l’étoile')
    // A comfortable margin, not a tie: `dueQueue` falls back to `created_at`
    // otherwise, which is a far more fragile thing to depend on.
    expect(new Date(second!.due).getTime() - new Date(head!.due).getTime()).toBeGreaterThan(
      10 * DAY,
    )
  })

  it('gives that card an answer with enough structure to fill the card', () => {
    const head = build().tables.card.find((c) => c.front.includes('lemme de l’étoile'))!
    expect(head.back.split('\n').length).toBeGreaterThan(4)
    expect(head.back).toContain('- $')
    expect(head.back).toContain('**')
  })
})

describe('landing seed — multiple-choice cards', () => {
  /**
   * A QCM has no structured representation: it is a plain card whose Markdown
   * happens to satisfy `parseQcm`. Breaking the shape fails SILENTLY — the card
   * just falls back to plain Markdown — so the parser is the only honest check.
   */
  const qcms = () =>
    build()
      .tables.card.map((c) => ({ card: c, parsed: parseQcm(c.front, c.back) }))
      .filter((x) => x.parsed !== null)

  it('ships several cards the review session will render as quizzes', () => {
    expect(qcms().length).toBeGreaterThanOrEqual(5)
  })

  it('spreads them over more than one subject', () => {
    const b = build()
    const deckSubject = new Map(b.tables.deck.map((d) => [d.id, d.subjectId]))
    const subjects = new Set(qcms().map((x) => deckSubject.get(x.card.deckId)))
    expect(subjects.size).toBeGreaterThanOrEqual(3)
  })

  it('never exceeds four options (option E would collide with the edit shortcut)', () => {
    for (const { parsed } of qcms()) {
      expect(parsed!.options.length).toBeGreaterThanOrEqual(2)
      expect(parsed!.options.length).toBeLessThanOrEqual(4)
    }
  })

  it('always carries a justification, never a bare letter', () => {
    for (const { parsed } of qcms()) expect(parsed!.explanation.length).toBeGreaterThan(20)
  })
})

describe('landing seed — history behind the analytics screen', () => {
  it('spans a calendar year’s worth of days, so the heatmap is not two lit months', () => {
    const days = new Set(build().tables.reviewLog.map((l) => l.review.slice(0, 10)))
    expect(days.size).toBeGreaterThan(150)
  })

  it('pins the current streak at exactly 31 days', () => {
    // Both streak figures are authored, not sampled: a run where the streak, the
    // record and the due total all came out at 44 looked like a placeholder.
    const days = new Set(build().tables.reviewLog.map((l) => l.review.slice(0, 10)))
    const midnight = localMidnight(NOW)
    const key = (i: number) => {
      const d = new Date(midnight - i * DAY)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    for (let i = 0; i < 31; i++) expect(days).toContain(key(i))
    // …and the day that ends it, or the streak is longer than advertised.
    expect(days).not.toContain(key(31))
  })

  it('leaves a LONGER past run, so "record" is not a copy of the current streak', () => {
    const days = new Set(build().tables.reviewLog.map((l) => l.review.slice(0, 10)))
    const midnight = localMidnight(NOW)
    const key = (i: number) => {
      const d = new Date(midnight - i * DAY)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    for (let i = 32; i <= 70; i++) expect(days).toContain(key(i)) // 39 days
    expect(days).not.toContain(key(71))
  })

  it('leaves rest days further back, so the heatmap has relief', () => {
    const days = new Set(build().tables.reviewLog.map((l) => l.review.slice(0, 10)))
    expect(days.size).toBeLessThan(210)
  })

  it('never records a review in the future', () => {
    expect(
      build().tables.reviewLog.every((l) => new Date(l.review).getTime() <= NOW.getTime()),
    ).toBe(true)
  })

  it('grades around an 88% retention — believable, not flattering', () => {
    const logs = build().tables.reviewLog
    const again = logs.filter((l) => l.rating === 1).length
    const retention = 1 - again / logs.length
    expect(retention).toBeGreaterThan(0.83)
    expect(retention).toBeLessThan(0.93)
  })

  it('varies review durations enough for the study-time curve to have relief', () => {
    const ms = build()
      .tables.reviewLog.map((l) => l.durationMs ?? 0)
      .sort((a, b) => a - b)
    expect(ms[0]).toBeGreaterThanOrEqual(4_000)
    expect(ms.at(-1)).toBeGreaterThan(20_000)
  })
})

describe('landing seed — brand consistency', () => {
  it('colours every subject from the app’s own pigment palette', () => {
    // Off-palette hexes make `pigmentSlotForHex` return null, and the tinted UI
    // silently falls back to a raw hex — subtly off-brand in every capture.
    const PIGMENTS = new Set([
      '#7999f5',
      '#00b6be',
      '#3fbe90',
      '#92be62',
      '#d1b64a',
      '#eb7a52',
      '#e06285',
      '#ba71cb',
    ])
    for (const s of build().tables.subject) expect(PIGMENTS).toContain(s.color.toLowerCase())
  })

  it('names every subject icon as a lucide export (lowercase ids fall back to BookOpen)', () => {
    for (const s of build().tables.subject) expect(s.icon).toMatch(/^[A-Z][A-Za-z]+$/)
  })
})
