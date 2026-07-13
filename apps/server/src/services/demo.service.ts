import { eq, inArray } from 'drizzle-orm'
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs'
import type { DB, Tx } from '../db/client'
import {
  appSettings,
  card,
  deck,
  exam,
  examSubject,
  generation,
  note,
  reviewLog,
  subject,
} from '../db/schema'
import { fsrsCardToColumns, fsrsLogToRow } from '../db/mappers'
import { localMidnight } from '../lib/day'

/**
 * Demo account seeding (spec §4). A compact, credible FR dataset seeded on every
 * new demo login so the account always looks alive but never accumulates a
 * stranger's edits. All timestamps are relative to `now` (nothing hard-coded that
 * would go stale) and there is NO personal information.
 */

/** The single app_settings key holding the last-seen demo session marker. */
const DEMO_KEY = 'demo'
/** Marker stored when a token carried no session_id (HS256 e2e / first pass). */
export const DEMO_NO_SESSION = 'no-session'

const DAY_MS = 86_400_000
/** Deterministic scheduler (fuzz off) so the seeded FSRS states are reproducible. */
const sched = fsrs(generatorParameters({ enable_fuzz: false }))

/** Read the stored demo session marker (or null if never seeded). */
export async function readDemoMarker(db: DB | Tx): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DEMO_KEY))
  const v = row?.value as { sessionId?: unknown } | undefined
  return typeof v?.sessionId === 'string' ? v.sessionId : null
}

/** Persist the demo session marker (upsert). */
async function writeDemoMarker(tx: Tx, marker: string): Promise<void> {
  await tx
    .insert(appSettings)
    .values({ key: DEMO_KEY, value: { sessionId: marker } })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { sessionId: marker }, updatedAt: new Date() },
    })
}

/** Delete every user-owned row for `userId` (child → parent, scoped). */
export async function wipeUserData(tx: Tx, userId: string): Promise<void> {
  await tx
    .delete(examSubject)
    .where(
      inArray(
        examSubject.examId,
        tx.select({ id: exam.id }).from(exam).where(eq(exam.userId, userId)),
      ),
    )
  await tx.delete(exam).where(eq(exam.userId, userId))
  await tx.delete(reviewLog).where(eq(reviewLog.userId, userId))
  await tx.delete(card).where(eq(card.userId, userId))
  await tx.delete(generation).where(eq(generation.userId, userId))
  await tx.delete(note).where(eq(note.userId, userId))
  await tx.delete(deck).where(eq(deck.userId, userId))
  await tx.delete(subject).where(eq(subject.userId, userId))
}

interface CardSpec {
  front: string
  back: string
  /** Past reviews to replay (days ago + grade) — drives the final FSRS state. */
  reviews: { daysAgo: number; rating: Grade }[]
}

const G: Grade = Rating.Good
const A: Grade = Rating.Again

/** Five review profiles → varied FSRS states (new / learning / young / mature / lapsed). */
function profile(i: number): CardSpec['reviews'] {
  switch (i % 5) {
    case 0:
      return [] // brand new → due now
    case 1:
      return [{ daysAgo: 6, rating: G }] // learning
    case 2:
      return [
        { daysAgo: 18, rating: G },
        { daysAgo: 11, rating: G },
        { daysAgo: 4, rating: G },
      ]
    case 3:
      return [
        { daysAgo: 20, rating: G },
        { daysAgo: 13, rating: G },
        { daysAgo: 7, rating: G },
        { daysAgo: 2, rating: G },
      ]
    default:
      return [
        { daysAgo: 19, rating: G },
        { daysAgo: 12, rating: G },
        { daysAgo: 6, rating: G },
        { daysAgo: 3, rating: A }, // a lapse
      ]
  }
}

/** Small pools of neutral, credible flashcards (no personal data). */
const AUTOMATA = [
  ['Qu’est-ce qu’un automate fini déterministe ?', 'Un 5-uplet (Q, Σ, δ, q₀, F) avec δ totale.'],
  ['Différence AFD / AFN ?', 'L’AFN autorise plusieurs transitions (ou ε) par symbole.'],
  ['Théorème de Kleene ?', 'Langages réguliers = langages reconnus par un automate fini.'],
  ['Lemme de l’étoile sert à…', 'prouver qu’un langage n’est PAS régulier.'],
  ['Déterminisation d’un AFN ?', 'Construction des sous-ensembles (2^Q états au pire).'],
]
const GRAMMARS = [
  ['Grammaire hors-contexte ?', 'Règles A → α avec A non-terminal, α ∈ (V∪Σ)*.'],
  ['Forme normale de Chomsky ?', 'A → BC ou A → a (plus S → ε éventuellement).'],
  ['Ambiguïté d’une grammaire ?', 'Un mot admet ≥ 2 arbres de dérivation distincts.'],
  ['Automate à pile reconnaît…', 'les langages hors-contexte.'],
]
const VOCAB = [
  ['to improve', 'améliorer'],
  ['to achieve', 'atteindre / réaliser'],
  ['a deadline', 'une échéance'],
  ['to gather', 'rassembler'],
  ['reliable', 'fiable'],
  ['to overcome', 'surmonter'],
  ['a flaw', 'un défaut'],
  ['to enhance', 'renforcer / améliorer'],
]

/**
 * Wipe the demo user's data and reseed the demo dataset in ONE call (the caller
 * wraps it in a transaction + advisory lock). Idempotent by construction: it
 * always wipes first, so replays converge to the same state.
 */
export async function seedDemo(tx: Tx, userId: string, marker: string): Promise<void> {
  await wipeUserData(tx, userId)

  const [subjTL] = await tx
    .insert(subject)
    .values({
      userId,
      name: 'Théorie des langages',
      color: '#6366f1',
      icon: 'book-open',
      position: 0,
    })
    .returning()
  const [subjEN] = await tx
    .insert(subject)
    .values({ userId, name: 'Anglais', color: '#22c55e', icon: 'languages', position: 1 })
    .returning()

  const [deckAuto] = await tx
    .insert(deck)
    .values({
      userId,
      subjectId: subjTL!.id,
      name: 'Automates',
      description: 'AFD, AFN, Kleene',
      position: 0,
    })
    .returning()
  const [deckGram] = await tx
    .insert(deck)
    .values({ userId, subjectId: subjTL!.id, name: 'Grammaires', position: 1 })
    .returning()
  const [deckVoc] = await tx
    .insert(deck)
    .values({ userId, subjectId: subjEN!.id, name: 'Vocabulaire', position: 0 })
    .returning()

  // Build the 25-card spec by cycling the pools across the three decks.
  const specs: { deckId: string; front: string; back: string; reviews: CardSpec['reviews'] }[] = []
  const pools = [
    { deckId: deckAuto!.id, pool: AUTOMATA },
    { deckId: deckGram!.id, pool: GRAMMARS },
    { deckId: deckVoc!.id, pool: VOCAB },
  ]
  let idx = 0
  for (let n = 0; n < 25; n++) {
    const p = pools[n % pools.length]!
    const pair = p.pool[Math.floor(n / pools.length) % p.pool.length]!
    specs.push({ deckId: p.deckId, front: pair[0]!, back: pair[1]!, reviews: profile(idx) })
    idx++
  }

  for (const s of specs) {
    // Simulate the past reviews with ts-fsrs to get a coherent final state + logs.
    let fsrsCard: FsrsCard = createEmptyCard(new Date())
    const logs: ReturnType<typeof fsrsLogToRow>[] = []
    for (const r of s.reviews) {
      const when = new Date(Date.now() - r.daysAgo * DAY_MS)
      const rec = sched.next(fsrsCard, when, r.rating)
      fsrsCard = rec.card
      // durationMs: a plausible 3–12 s so study-time analytics is non-empty.
      logs.push(fsrsLogToRow('', rec.log, 3000 + ((r.daysAgo * 971) % 9000)))
    }
    const [cardRow] = await tx
      .insert(card)
      .values({
        userId,
        deckId: s.deckId,
        front: s.front,
        back: s.back,
        ...fsrsCardToColumns(fsrsCard),
      })
      .returning()
    for (const l of logs) {
      await tx.insert(reviewLog).values({ ...l, cardId: cardRow!.id, userId })
    }
  }

  // One exam at J+10 (local midnight) linked to the TL subject.
  const now = new Date()
  const examDate = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() + 10)
  const [examRow] = await tx
    .insert(exam)
    .values({ userId, title: 'Partiel — Théorie des langages', date: examDate })
    .returning()
  await tx.insert(examSubject).values({ examId: examRow!.id, subjectId: subjTL!.id })

  await writeDemoMarker(tx, marker)
}
