import { beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from './client'
import { card, cardColumns } from './schema'
import {
  resetDb,
  seedCard,
  seedDeck,
  seedSubject,
  DEFAULT_DEV_USER_ID as U,
} from '../test-support/harness'
import { exportBackup } from '../services/backup.service'

/**
 * T-060. Migration 0012 added `front_fold` / `back_fold`, STORED generated
 * mirrors of the card text kept for the search. They made every `select()` on
 * `card` — the backup dump, the due queue, the card list, each review — ship
 * roughly TWICE the card text it had any use for, to callers that cannot read
 * the folds at all (`cardToDto` and `toFsrsCard` both take a row type with them
 * omitted).
 *
 * The fix is one derived select shape, `cardColumns`. This file holds the two
 * claims that matter about it: it costs materially less, and it costs NOTHING
 * ELSE — a dump that quietly lost a real column would be far worse than the
 * bytes it saved.
 */

/** Card text of a realistic size: a course excerpt, not `'Q1'`. */
const FRONT =
  "Énoncer le lemme de l'étoile pour les langages réguliers, et dire précisément ce qu'il permet de démontrer (et ce qu'il NE permet pas de démontrer)."
const BACK =
  "Pour tout langage régulier L il existe p ≥ 1 tel que tout mot w ∈ L avec |w| ≥ p se décompose en w = xyz avec |xy| ≤ p, |y| ≥ 1 et xyⁿz ∈ L pour tout n ≥ 0. C'est une condition NÉCESSAIRE : elle réfute la régularité (par contraposée), elle ne la prouve jamais."

const CORPUS = 400

async function seedCorpus() {
  const s = await seedSubject(db, { name: 'Théorie des langages' })
  const d = await seedDeck(db, s.id, { name: 'Automates' })
  for (let i = 0; i < CORPUS; i++) {
    await seedCard(db, d.id, { front: `${FRONT} (${i})`, back: `${BACK} (${i})` })
  }
  return d
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8')

/** A SELECT * row minus the folds — what `cardColumns` is claimed to return. */
function withoutFolds<T extends { frontFold: string; backFold: string }>(
  row: T,
): Omit<T, 'frontFold' | 'backFold'> {
  const copy: Partial<T> = { ...row }
  delete copy.frontFold
  delete copy.backFold
  return copy as Omit<T, 'frontFold' | 'backFold'>
}

describe('cardColumns — the fold mirrors stay in the database', () => {
  beforeEach(async () => {
    await resetDb(db)
  })

  it('reads about half the bytes a bare select() does', async () => {
    await seedCorpus()

    const wide = await db.select().from(card).where(eq(card.userId, U))
    const narrow = await db.select(cardColumns).from(card).where(eq(card.userId, U))

    expect(wide).toHaveLength(CORPUS)
    expect(narrow).toHaveLength(CORPUS)

    const wideBytes = bytes(wide)
    const narrowBytes = bytes(narrow)
    // Measured on this corpus (PGlite, 400 cards of ~420 characters):
    //   SELECT *      515 561 bytes serialized
    //   cardColumns   329 781 bytes           → 1.56×, i.e. 464 bytes/card saved,
    // which is the front and back text once over, exactly as predicted. The
    // ratio is NOT 2× because a row also carries ids, timestamps, ten FSRS
    // numbers and its own JSON key names; the duplicated part is the text only.
    //
    // The assertion is loose on purpose: the exact ratio moves with how much
    // text a corpus has per row, and the claim being pinned is "the card text is
    // not sent twice", not a constant.
    expect(narrowBytes).toBeLessThan(wideBytes * 0.75)
    // Non-vacuous: the saving has to be the card text, not a rounding artefact.
    expect(wideBytes - narrowBytes).toBeGreaterThan(CORPUS * (FRONT.length + BACK.length) * 0.5)
  })

  it('drops the folds and NOTHING else', async () => {
    const d = await seedCorpus()
    await seedCard(db, d.id, { front: 'accents: ÉÀÜ', back: '', lastReview: null })

    const wide = await db.select().from(card).orderBy(card.id)
    const narrow = await db.select(cardColumns).from(card).orderBy(card.id)

    // The key sets differ by exactly the two fold columns...
    const wideKeys = Object.keys(wide[0]!).sort()
    const narrowKeys = Object.keys(narrow[0]!).sort()
    expect(wideKeys.filter((k) => !narrowKeys.includes(k))).toEqual(['backFold', 'frontFold'])
    expect(narrowKeys.filter((k) => !wideKeys.includes(k))).toEqual([])

    // ...and every surviving column is value-identical, row for row. This is the
    // claim a looser "it still has 15 keys" test would not make: no column was
    // swapped, reordered onto the wrong row, or silently defaulted.
    for (const [i, row] of narrow.entries()) {
      expect(row).toEqual(withoutFolds(wide[i]!))
    }
  })

  it('leaves the backup dump byte-identical', async () => {
    await seedCorpus()

    // What the dump would have contained when `exportBackup` read SELECT *: the
    // same serializer, fed the wide rows. (`isoOrNull`/`iso` are inlined here
    // rather than exported, so the mapping is restated — deliberately, so a
    // change to either side of it shows up as a difference.)
    const wide = await db.select().from(card).where(eq(card.userId, U))
    const before = wide
      .map((r) => ({
        id: r.id,
        deckId: r.deckId,
        front: r.front,
        back: r.back,
        due: r.due.toISOString(),
        stability: r.stability,
        difficulty: r.difficulty,
        elapsedDays: r.elapsedDays,
        scheduledDays: r.scheduledDays,
        learningSteps: r.learningSteps,
        reps: r.reps,
        lapses: r.lapses,
        state: r.state,
        lastReview: r.lastReview ? r.lastReview.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    const dump = await exportBackup(db, U)
    const after = [...dump.tables.card].sort((a, b) => a.id.localeCompare(b.id))

    expect(after).toEqual(before)
    // And the dump never carried the folds in the first place — so the saving is
    // pure wire cost between Postgres and the server, with no export field lost.
    expect(Object.keys(after[0]!)).not.toContain('frontFold')
    expect(Object.keys(after[0]!)).not.toContain('backFold')
  })
})
