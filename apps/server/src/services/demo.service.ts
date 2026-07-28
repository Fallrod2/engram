import { and, eq, inArray } from 'drizzle-orm'
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

/**
 * Read the stored demo session marker (or null if never seeded). Scoped to the
 * demo user's row `(demoUserId, 'demo')` now that `app_settings` is per-user
 * (spec BYOK §1.4 / amendment §3).
 */
export async function readDemoMarker(db: DB | Tx, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, DEMO_KEY)))
  const v = row?.value as { sessionId?: unknown } | undefined
  return typeof v?.sessionId === 'string' ? v.sessionId : null
}

/** Persist the demo session marker (upsert) under `(userId, 'demo')`. */
async function writeDemoMarker(tx: Tx, userId: string, marker: string): Promise<void> {
  await tx
    .insert(appSettings)
    .values({ userId, key: DEMO_KEY, value: { sessionId: marker } })
    .onConflictDoUpdate({
      target: [appSettings.userId, appSettings.key],
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

/**
 * Content pools — neutral, credible flashcards, no personal data (T-027).
 *
 * Each pool must hold AT LEAST as many entries as the slots its deck receives
 * (7 each today, see `demoCardSpecs`). It used to hold fewer, and the builder
 * cycled with a modulo: the visitor answered the same question twice in one
 * session and "Cartes les plus dures" listed the same card twice. The modulo is
 * gone — a pool that runs short now throws — and `demo-seed.test.ts` pins that
 * no two seeded cards share a front.
 *
 * This is the demo's shop window: write real cards here, not filler.
 */
const AUTOMATA = [
  [
    'Qu’est-ce qu’un automate fini déterministe ?',
    'Un 5-uplet (Q, Σ, δ, q₀, F) où δ : Q × Σ → Q est une fonction totale : un seul état atteignable par symbole lu.',
  ],
  [
    'Différence AFD / AFN ?',
    'L’AFN autorise plusieurs transitions (ou des ε-transitions) pour un même symbole ; l’AFD en impose exactement une.',
  ],
  [
    'Théorème de Kleene ?',
    'Langages réguliers = langages reconnus par un automate fini = langages décrits par une expression régulière.',
  ],
  [
    'À quoi sert le lemme de l’étoile ?',
    'À prouver qu’un langage n’est PAS régulier : au-delà d’une longueur seuil, tout mot devrait pouvoir se pomper.',
  ],
  [
    'Comment déterminiser un AFN ?',
    'Par la construction des sous-ensembles : un état de l’AFD est un ensemble d’états de l’AFN, d’où 2^|Q| états au pire.',
  ],
  [
    'Que dit le théorème de Myhill-Nerode ?',
    'Un langage est régulier ssi son nombre de classes d’équivalence à droite est fini ; ce nombre est la taille de l’AFD minimal.',
  ],
  [
    'Comment obtenir le complémentaire d’un langage régulier ?',
    'On déterminise, on complète la fonction de transition (état puits), puis on échange états finaux et non finaux.',
  ],
]
const GRAMMARS = [
  [
    'Grammaire hors-contexte ?',
    'Un ensemble de règles A → α, avec A non-terminal et α ∈ (V ∪ Σ)* : le membre gauche ne dépend d’aucun contexte.',
  ],
  [
    'Forme normale de Chomsky ?',
    'Toute règle est A → BC ou A → a, plus S → ε si le langage contient le mot vide.',
  ],
  [
    'Quand une grammaire est-elle ambiguë ?',
    'Quand un même mot admet au moins deux arbres de dérivation distincts.',
  ],
  [
    'Que reconnaît un automate à pile ?',
    'Exactement les langages hors-contexte : la pile mémorise un contexte non borné, ce qu’un automate fini ne sait pas faire.',
  ],
  [
    'Hiérarchie de Chomsky, du plus général au plus restreint ?',
    'Type 0 (récursivement énumérables) ⊃ type 1 (contextuels) ⊃ type 2 (hors-contexte) ⊃ type 3 (réguliers).',
  ],
  [
    'Que contient FIRST(α) ?',
    'Les terminaux qui peuvent commencer un mot dérivé de α, plus ε si α se dérive en ε.',
  ],
  [
    'Comment éliminer la récursivité à gauche de A → Aα | β ?',
    'On la rend droite : A → β A′ et A′ → α A′ | ε.',
  ],
]
const VOCAB = [
  ['to improve', 'améliorer'],
  ['to achieve', 'atteindre, mener à bien'],
  ['a deadline', 'une échéance, une date limite'],
  ['to gather', 'rassembler, recueillir'],
  ['reliable', 'fiable'],
  ['to overcome', 'surmonter'],
  ['a flaw', 'un défaut, une faille'],
]

/** Index into the `pools` array built in `seedDemo` — hence the target deck. */
const POOL_AUTOMATA = 0
const POOL_GRAMMARS = 1
const POOL_VOCAB = 2

export interface DemoQcm {
  /** `POOL_AUTOMATA` | `POOL_GRAMMARS` | `POOL_VOCAB`. */
  pool: number
  front: string
  back: string
  /** Index into `profile()` — the FSRS history replayed for this card. */
  profile: number
}

/**
 * Multiple-choice cards (T-022). A QCM has NO structured representation in the
 * database: a card renders as an interactive quiz when its Markdown matches the
 * shape the generation prompt asks for (`ai/prompts/cards.v1.ts`,
 * `QUIZ_INSTRUCTIONS`) and the render-time parser accepts
 * (`packages/shared/src/qcm.ts`, `parseQcm`). That shape is a CONTRACT,
 * and breaking it fails SILENTLY — the card just falls back to the plain
 * Markdown rendering, which is exactly the bug this seed had:
 *
 *  - FRONT: the question, then 2 to 4 options — never 5, `E` is the edit
 *    shortcut — as a Markdown list `- A) …`, lettered consecutively from A, the
 *    option block being the LAST block of the front;
 *  - BACK: the answer letter followed by `)`, then a one-sentence justification.
 *    NEVER the letter followed by `.`: that form is refused on purpose, it
 *    collides with French abbreviations and initials (`c.-à-d.`, `A. Aho`).
 *
 * These four cards TAKE the first four of the 25 slots built by
 * `demoCardSpecs()`, declaring their own deck and review profile, so the dataset
 * keeps its exact shape — 25 cards, 60 review logs, same per-deck counts.
 *
 * Profile 1 is load-bearing. It replays a single `Good` 6 days ago, which leaves
 * the card in `learning` on a 10-minute step: its due date is therefore 6 days
 * in the PAST. That QCM is due the second the demo session opens, and since it
 * is seeded FIRST it also wins the `created_at` tie-break against the other
 * equally-overdue learning cards — so `dueQueue` (ordered by `due`, then
 * `created_at`) hands it to the visitor as the very first card. Without that, a
 * visitor could finish a whole session without ever meeting a QCM.
 */
export const DEMO_QCM_CARDS: readonly DemoQcm[] = [
  {
    pool: POOL_AUTOMATA,
    profile: 1,
    front: [
      'Par quelles opérations la classe des langages réguliers est-elle close ?',
      '',
      '- A) L’union uniquement',
      '- B) L’union et la concaténation uniquement',
      '- C) L’union, l’intersection et le complément',
      '- D) Aucune opération booléenne',
    ].join('\n'),
    back: 'C) Les langages réguliers forment une algèbre de Boole : union, intersection et complément restent réguliers.',
  },
  {
    pool: POOL_GRAMMARS,
    profile: 2,
    front: [
      'Pourquoi une grammaire récursive à gauche bloque-t-elle un analyseur descendant ?',
      '',
      '- A) Elle engendre un langage vide',
      '- B) L’analyseur boucle sans consommer de symbole',
      '- C) Elle devient nécessairement ambiguë',
    ].join('\n'),
    back: 'B) La règle A → Aα se réapplique indéfiniment avant toute consommation de l’entrée.',
  },
  {
    pool: POOL_VOCAB,
    profile: 3,
    front: [
      'Which verb collocates with “deadline”?',
      '',
      '- A) to meet',
      '- B) to gather',
      '- C) to overcome',
      '- D) to enhance',
    ].join('\n'),
    back: 'A) You meet a deadline — the other three verbs never take it as an object.',
  },
  {
    pool: POOL_AUTOMATA,
    profile: 4,
    front: [
      'Que fait une ε-transition dans un automate fini non déterministe ?',
      '',
      '- A) Elle consomme un symbole de l’entrée',
      '- B) Elle change d’état sans lire de symbole',
      '- C) Elle interdit tout retour en arrière',
    ].join('\n'),
    back: 'B) Elle change d’état sans consommer de symbole ; on l’élimine par clôture epsilon.',
  },
]

/** The seed always holds 25 cards — the QCM take four of those slots. */
const TOTAL_CARDS = 25

/** A card the seed will write, still pool-indexed (deck ids only exist in `seedDemo`). */
export interface DemoCardSpec {
  /** `POOL_AUTOMATA` | `POOL_GRAMMARS` | `POOL_VOCAB`. */
  pool: number
  front: string
  back: string
  reviews: CardSpec['reviews']
}

/**
 * The 25 cards of the seed, as pure data — no DB, no clock beyond the relative
 * `daysAgo` of the profiles. Extracted from `seedDemo` so the invariants can be
 * tested without a database (`demo-seed.test.ts`).
 *
 * Order matters: QCM first, because seeding order decides `created_at`, which is
 * how `dueQueue` breaks ties between cards sharing a due date (`DEMO_QCM_CARDS`).
 *
 * Then a round-robin over the three pools: slot n goes to pool n % 3 and takes
 * that pool's entry ⌊n / 3⌋. NO modulo on the entry index — running past the end
 * of a pool is a bug (it used to duplicate cards silently, T-027), so it throws.
 */
export function demoCardSpecs(): DemoCardSpec[] {
  const pools = [AUTOMATA, GRAMMARS, VOCAB]
  const specs: DemoCardSpec[] = DEMO_QCM_CARDS.map((q) => ({
    pool: q.pool,
    front: q.front,
    back: q.back,
    reviews: profile(q.profile),
  }))
  for (let n = 0; n < TOTAL_CARDS - DEMO_QCM_CARDS.length; n++) {
    const poolIndex = n % pools.length
    const pool = pools[poolIndex]!
    const entryIndex = Math.floor(n / pools.length)
    const pair = pool[entryIndex]
    if (!pair) {
      throw new Error(
        `demo seed: pool ${poolIndex} has ${pool.length} entries but slot ${n} needs entry ${entryIndex}. ` +
          'Write more distinct cards — never cycle, it duplicates them (T-027).',
      )
    }
    specs.push({ pool: poolIndex, front: pair[0]!, back: pair[1]!, reviews: profile(n) })
  }
  return specs
}

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

  // Pool index → deck. Same order as POOL_AUTOMATA / POOL_GRAMMARS / POOL_VOCAB.
  const deckOfPool = [deckAuto!.id, deckGram!.id, deckVoc!.id]
  const specs = demoCardSpecs().map((s) => ({ ...s, deckId: deckOfPool[s.pool]! }))

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

  await writeDemoMarker(tx, userId, marker)
}
