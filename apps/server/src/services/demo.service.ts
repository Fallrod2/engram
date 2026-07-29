import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs'
import type { DemoSeedStatusResponse, GenerationItem } from '@engram/shared'
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
import { expandCloze } from '../ai/cloze'
import { localMidnight } from '../lib/day'
import { STUDY_KEY } from './study-settings.service'
import { ONBOARDING_KEY } from './onboarding.service'

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

/**
 * Constant key for the `pg_advisory_xact_lock` that serializes the demo reset,
 * taken by `http/demo.ts` inside the seeding transaction.
 *
 * It lives HERE, next to `demoSeedStatus`, because that function probes the very
 * same lock to answer "is a seed running right now". Two constants would drift
 * and the status endpoint would quietly report `pending` forever.
 */
export const DEMO_LOCK_KEY = 918273

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

/* -------------------------------------------------------------- seed status -- */

/**
 * Is a demo seed executing RIGHT NOW? Answered by looking for the advisory lock
 * that `http/demo.ts` takes inside the seeding transaction, in `pg_locks`.
 *
 * WHY A LOCK PROBE AND NOT A PROGRESS TABLE. The seed writes its whole dataset
 * AND its session marker in one transaction, so from any other connection its
 * work is strictly invisible until it commits: there is nothing to read. The
 * advisory lock is the one piece of the running transaction that IS visible
 * cluster-wide while it runs — `pg_locks` is a shared view — so it is the only
 * honest in-flight signal available without adding a second writer.
 *
 * `pg_advisory_xact_lock(<bigint>)` registers as `classid = 0`,
 * `objid = <key>`, `objsubid = 1`; the two-int overload uses `objsubid = 2`, so
 * the predicate is pinned to the exact shape `http/demo.ts` takes. Any failure
 * (a Postgres flavour without the view, a permission quirk) degrades to `false`
 * — a polled probe must never turn a working demo into a 500.
 */
async function isSeedRunning(db: DB | Tx): Promise<boolean> {
  try {
    const res = await db.execute(sql`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory'
          and classid = 0
          and objid = ${DEMO_LOCK_KEY}
          and objsubid = 1
          and granted
      ) as running`)
    // Normalize across drivers: postgres-js returns an array, PGlite `{ rows }`.
    const rows = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])
    return (rows[0] as { running?: boolean } | undefined)?.running === true
  } catch {
    return false
  }
}

/**
 * Project the demo account's seeding state FOR ONE SESSION (two round-trips: the
 * marker row, then the lock probe). The order of the tests IS the correctness
 * argument:
 *
 *  1. the marker committed for THIS session → `ready`. That marker is the only
 *     authority on "the data is there", because it commits with the data.
 *  2. else, the seed lock held → `seeding`. Note the lock is global to the demo
 *     reset, not per session: a seed for a *different* session still reads as
 *     `seeding`, which is true and is what the caller should wait on anyway.
 *  3. else `pending` — nothing committed for this session and nothing running.
 *
 * Deliberately no sub-steps: see `demoSeedStateSchema` in `@engram/shared`.
 */
export async function demoSeedStatus(
  db: DB | Tx,
  userId: string,
  marker: string,
): Promise<DemoSeedStatusResponse> {
  const [row] = await db
    .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, DEMO_KEY)))
  const stored = (row?.value as { sessionId?: unknown } | undefined)?.sessionId
  if (typeof stored === 'string' && stored === marker) {
    return { state: 'ready', readyAt: row!.updatedAt.toISOString() }
  }
  return { state: (await isSeedRunning(db)) ? 'seeding' : 'pending', readyAt: null }
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

/* ------------------------------------------- the pre-recorded generation -- */

/**
 * The sample note shipped with the demo (T-031). Real course Markdown on a topic
 * the seeded subjects already cover ("Théorie des langages"), deliberately
 * ADJACENT to the seeded decks rather than overlapping them: nothing here repeats
 * a card of `AUTOMATA` / `GRAMMARS`, so a visitor who accepts the proposals below
 * ends up with a deck that grew, not with duplicates.
 *
 * Its length matters. Too short and the generation would look implausible; too
 * long and the note screen becomes a wall. ~2 000 characters is roughly one
 * lecture section, which is what a real import looks like.
 */
export const DEMO_SAMPLE_NOTE_TITLE = 'Analyse lexicale — du texte aux lexèmes'

export const DEMO_SAMPLE_NOTE_CONTENT = `# Analyse lexicale

L'analyseur lexical (ou *scanner*) est le premier étage d'un compilateur. Il lit
le texte source caractère par caractère et le découpe en **lexèmes**, les plus
petites unités porteuses de sens du langage.

## Vocabulaire

- **Lexème** : la suite de caractères effectivement lue dans la source
  (\`compteur\`, \`42\`, \`:=\`).
- **Unité lexicale** (*token*) : la catégorie à laquelle appartient ce lexème
  (\`IDENT\`, \`NOMBRE\`, \`AFFECTATION\`). C'est elle que l'analyseur syntaxique
  consomme — le parseur ne voit jamais les caractères.
- **Motif** : la description, presque toujours une expression régulière, de
  l'ensemble des lexèmes d'une unité lexicale.
- **Attribut** : l'information annexe transportée avec le token — valeur
  numérique, entrée dans la table des symboles, position dans le fichier.

## De l'expression régulière à l'automate

Chaque motif est une expression régulière. La construction de Thompson en fait un
AFN, la construction des sous-ensembles un AFD, et la minimisation de Moore
réduit cet AFD au plus petit reconnaissant le même langage. L'analyseur exécute
l'union de tous ces automates : un seul parcours du texte suffit, sans retour en
arrière dans le cas courant.

## Deux règles de désambiguïsation

Plusieurs motifs peuvent reconnaître le même préfixe. Deux règles tranchent, dans
cet ordre :

1. **Plus longue correspondance** (*maximal munch*) : on retient le plus long
   préfixe reconnu. C'est ce qui fait lire \`>=\` comme un seul token et non comme
   \`>\` suivi de \`=\`.
2. **Priorité de la première règle déclarée** : à longueur égale, le motif écrit
   en premier gagne. C'est ainsi que \`while\` devient le mot-clé WHILE et non un
   identificateur — les mots-clés sont déclarés avant le motif des identificateurs.

## Ce que le scanner jette, et ce qu'il garde

Espaces, tabulations, retours à la ligne et commentaires sont reconnus puis
**absorbés** : ils ne produisent aucun token. En revanche le scanner tient à jour
le numéro de ligne et de colonne, sans quoi aucun message d'erreur du compilateur
ne pourrait désigner un endroit précis du fichier.

Enfin, un langage dont l'analyse lexicale dépend du contexte syntaxique (les
chevrons de \`List<List<int>>\` en C++, l'indentation significative en Python)
force à faire remonter de l'information du parseur vers le scanner : la séparation
nette des deux étages est une simplification de cours, pas une loi.
`

/**
 * WHAT GOES IN \`generation.model\` FOR A RUN THAT NEVER RAN.
 *
 * No model produced these cards, so no model id may appear here. Writing
 * \`claude-sonnet-4-6\` would make the database itself assert something false, and
 * every later reader — an export, an analytics query, a future cost report —
 * would inherit the lie. This sentinel is deliberately NOT parseable as a model
 * name and states the situation in the value itself. \`provider\` is \`null\` and
 * \`promptTokens\`/\`completionTokens\` stay \`null\` for the same reason: zero would
 * be a measurement, null is the absence of one.
 */
export const DEMO_PRERECORDED_MODEL = 'none — hand-written demo sample'

/** One hand-written proposal, before the cloze templates are materialised. */
type SampleSpec =
  | { kind: 'qa'; contentType: GenerationItem['contentType']; front: string; back: string }
  | { kind: 'cloze'; contentType: GenerationItem['contentType']; clozeText: string }

/**
 * The proposals of the pre-recorded run, as pure data. They are written the way
 * the \`mixed\` evaluator writes them (a format + a content type per unit), because
 * the review screen downstream is the REAL one: badges, editing, accept/reject
 * and insertion all behave exactly as they would after a live generation. Only
 * the provenance is staged — hence \`origin: 'prerecorded'\` and the banner.
 */
const DEMO_SAMPLE_SPECS: readonly SampleSpec[] = [
  {
    kind: 'qa',
    contentType: 'definition',
    front: 'Quelle est la différence entre un lexème et une unité lexicale ?',
    back: 'Le lexème est la suite de caractères réellement lue dans la source (`compteur`) ; l’unité lexicale est la catégorie à laquelle il appartient (`IDENT`). Le parseur consomme des unités, jamais des lexèmes.',
  },
  {
    // Two distinct masks → `expandCloze` materialises TWO independent cards, so
    // the visitor meets the cloze format without any special path existing.
    kind: 'cloze',
    contentType: 'concept',
    clozeText:
      'Quand plusieurs motifs reconnaissent le même préfixe, la règle de la {{c1::plus longue correspondance}} s’applique d’abord ; à longueur égale, c’est la {{c2::priorité de la première règle déclarée}} qui tranche.',
  },
  {
    kind: 'qa',
    contentType: 'concept',
    front: 'Pourquoi les mots-clés sont-ils déclarés avant le motif des identificateurs ?',
    back: 'Parce qu’à longueur de correspondance égale, c’est le motif écrit en premier qui l’emporte. Sans cet ordre, `while` serait reconnu comme un identificateur ordinaire.',
  },
  {
    kind: 'qa',
    contentType: 'list',
    front:
      'Quelle chaîne de constructions mène d’une expression régulière à l’automate exécuté par le scanner ?',
    back: 'Thompson : expression régulière → AFN. Sous-ensembles : AFN → AFD. Minimisation de Moore : AFD → AFD minimal.',
  },
  {
    kind: 'qa',
    contentType: 'fact',
    front: 'Que devient un commentaire pendant l’analyse lexicale ?',
    back: 'Il est reconnu par un motif puis absorbé : il ne produit aucun token. Seuls le numéro de ligne et de colonne continuent d’être mis à jour.',
  },
  {
    kind: 'qa',
    contentType: 'definition',
    front: 'Qu’appelle-t-on l’attribut d’une unité lexicale ?',
    back: 'L’information annexe transportée avec le token : valeur numérique, entrée dans la table des symboles, position dans le fichier.',
  },
]

/**
 * Materialise the pre-recorded proposals into the exact \`GenerationItem\` shape a
 * real \`mixed\` run produces — cloze templates expanded through the SAME
 * \`expandCloze\` the job uses, every item \`status: 'pending'\` (nothing is
 * pre-triaged: the whole point is that the visitor does the triage).
 *
 * Pure (no DB, no clock beyond the ids), so \`demo-seed.test.ts\` can pin its
 * invariants. A malformed template THROWS rather than silently shipping fewer
 * cards — in the live path a bad cloze is a model mistake to skip, here it would
 * be OUR typo, and a demo that quietly loses a card is worse than a failing test.
 */
export function demoSampleGenerationItems(): GenerationItem[] {
  const items: GenerationItem[] = []
  for (const spec of DEMO_SAMPLE_SPECS) {
    if (spec.kind === 'cloze') {
      const expansion = expandCloze(spec.clozeText)
      if (!expansion.ok) {
        throw new Error(`demo sample generation: cloze invalide — ${expansion.reason}`)
      }
      for (const c of expansion.cards) {
        items.push({
          id: crypto.randomUUID(),
          front: c.front,
          back: c.back,
          status: 'pending',
          kind: 'cloze',
          ...(spec.contentType ? { contentType: spec.contentType } : {}),
          clozeText: spec.clozeText,
        })
      }
      continue
    }
    items.push({
      id: crypto.randomUUID(),
      front: spec.front,
      back: spec.back,
      status: 'pending',
      kind: 'qa',
      ...(spec.contentType ? { contentType: spec.contentType } : {}),
    })
  }
  return items
}

/**
 * Wipe the demo user's data and reseed the demo dataset in ONE call (the caller
 * wraps it in a transaction + advisory lock). Idempotent by construction: it
 * always wipes first, so replays converge to the same state.
 *
 * WHY EVERY INSERT IS BATCHED (perf). This runs on Vercel against a Supabase
 * database in another datacentre: the cost is dominated by ROUND-TRIPS, not by
 * the work the database does. The row-at-a-time version emitted 101 statements
 * (25 `INSERT … RETURNING` for the cards, each followed by up to 4 more for its
 * review logs) and took ~15 s in production at ~80 ms/round-trip. This one emits
 * 15 — 7 scoped DELETEs plus one multi-row INSERT per table. `demo.service.spec.ts`
 * pins that count ("emits a bounded number of statements"), so a `for` loop that
 * sneaks an insert back in fails the suite instead of silently costing seconds.
 *
 * TWO CONSEQUENCES OF BATCHING, both load-bearing:
 *
 *  1. NO `returning()` ANY MORE. Primary keys are `text` columns whose default is
 *     a client-side `crypto.randomUUID()` (`db/schema/columns.ts`), so the ids are
 *     minted HERE and the children reference them without a round-trip.
 *  2. `created_at` IS SET EXPLICITLY on the cards. It used to be distinct by
 *     accident — one insert per card, ~80 ms apart. In a single statement every
 *     row would get the same instant, and `dueQueue` (order by `due`, then
 *     `created_at`) would lose the tie-break that puts a QCM in front of the
 *     visitor (see `DEMO_QCM_CARDS`). The order is now stated, not hoped for:
 *     strictly increasing, 1 ms apart, in `demoCardSpecs()` order.
 *
 * The seed publishes NO intermediate progress. It commits once, so from another
 * connection there is nothing partial to observe; `demoSeedStatus` reports the
 * honest binary (running / committed) instead of inventing phases.
 */
export async function seedDemo(tx: Tx, userId: string, marker: string): Promise<void> {
  // ONE clock for the whole seed: the FSRS replay below derives every due date
  // from it, so a seed is a pure function of (`now`, specs) rather than of how
  // long the statements happened to take.
  const now = new Date()

  await wipeUserData(tx, userId)

  // The demo account is SHARED by every visitor, so every preference a visitor
  // can write must be reset with its data — otherwise one visitor's choice
  // becomes the next visitor's app. Two keys qualify today:
  //
  //   `study`      — one visitor setting `newCardsPerDay: 0` would hand the next
  //                  one a queue with no new cards, for good.
  //   `onboarding` — the first-run marker (T-049). The route already refuses to
  //                  write it for the demo, so this is belt-and-braces rather
  //                  than the primary guarantee: it also cleans up a marker
  //                  written before the account was flagged `is_demo`.
  //
  // The key list is EXPLICIT, never "delete every key": the session marker
  // (`demo`) is rewritten below and the AI config (`ai`) is not visitor-writable
  // (`requireNotDemo` guards every AI write). NOT folded into `wipeUserData`
  // either: that helper is also the GDPR delete path, where `admin.service.ts`
  // already drops the whole `app_settings` row set.
  await tx
    .delete(appSettings)
    .where(
      and(eq(appSettings.userId, userId), inArray(appSettings.key, [STUDY_KEY, ONBOARDING_KEY])),
    )

  const subjTLId = crypto.randomUUID()
  const subjENId = crypto.randomUUID()
  await tx.insert(subject).values([
    {
      id: subjTLId,
      userId,
      name: 'Théorie des langages',
      color: '#6366f1',
      icon: 'book-open',
      position: 0,
    },
    {
      id: subjENId,
      userId,
      name: 'Anglais',
      color: '#22c55e',
      icon: 'languages',
      position: 1,
    },
  ])

  const deckAutoId = crypto.randomUUID()
  const deckGramId = crypto.randomUUID()
  const deckVocId = crypto.randomUUID()
  await tx.insert(deck).values([
    {
      id: deckAutoId,
      userId,
      subjectId: subjTLId,
      name: 'Automates',
      description: 'AFD, AFN, Kleene',
      position: 0,
    },
    { id: deckGramId, userId, subjectId: subjTLId, name: 'Grammaires', position: 1 },
    { id: deckVocId, userId, subjectId: subjENId, name: 'Vocabulaire', position: 0 },
  ])

  // Pool index → deck. Same order as POOL_AUTOMATA / POOL_GRAMMARS / POOL_VOCAB.
  const deckOfPool = [deckAutoId, deckGramId, deckVocId]
  const specs = demoCardSpecs()

  const cardRows: (typeof card.$inferInsert)[] = []
  const logRows: (typeof reviewLog.$inferInsert)[] = []
  specs.forEach((s, i) => {
    // Simulate the past reviews with ts-fsrs to get a coherent final state + logs.
    const cardId = crypto.randomUUID()
    let fsrsCard: FsrsCard = createEmptyCard(now)
    for (const r of s.reviews) {
      const when = new Date(now.getTime() - r.daysAgo * DAY_MS)
      const rec = sched.next(fsrsCard, when, r.rating)
      fsrsCard = rec.card
      // durationMs: a plausible 3–12 s so study-time analytics is non-empty.
      logRows.push({
        ...fsrsLogToRow('', rec.log, 3000 + ((r.daysAgo * 971) % 9000)),
        cardId,
        userId,
      })
    }
    cardRows.push({
      id: cardId,
      userId,
      deckId: deckOfPool[s.pool]!,
      front: s.front,
      back: s.back,
      // Strictly increasing in spec order, and all in the past — this IS the
      // due-queue tie-break (see the header note), not incidental bookkeeping.
      createdAt: new Date(now.getTime() - specs.length + i),
      ...fsrsCardToColumns(fsrsCard),
    })
  })

  await tx.insert(card).values(cardRows)
  await tx.insert(reviewLog).values(logRows)

  // The sample note + its PRE-RECORDED generation (T-031). Two extra statements,
  // one per table — the budget line in `demo.service.spec.ts` moved 16 → 18 for
  // exactly these, and there is no way to fold them: a note and a generation are
  // two tables. Fixed cost, independent of the dataset size.
  //
  // The visitor lands on a `succeeded` run whose items are all `pending`, i.e. on
  // the real triage board: accept / edit / reject, then insert into `Automates`
  // and revise. Everything downstream is the production path; the ONLY staged
  // thing is that no provider was called — which `origin: 'prerecorded'` states
  // in the database and the review screen repeats to the visitor.
  const sampleNoteId = crypto.randomUUID()
  await tx.insert(note).values({
    id: sampleNoteId,
    userId,
    subjectId: subjTLId,
    title: DEMO_SAMPLE_NOTE_TITLE,
    sourceType: 'md',
    originalFilename: 'analyse-lexicale.md',
    content: DEMO_SAMPLE_NOTE_CONTENT,
  })
  await tx.insert(generation).values({
    userId,
    noteId: sampleNoteId,
    deckId: deckAutoId,
    kind: 'mixed',
    status: 'succeeded',
    origin: 'prerecorded',
    model: DEMO_PRERECORDED_MODEL,
    // `provider` and the token counts stay NULL: nothing ran, so there is nothing
    // to report. A zero would read as a measurement.
    items: demoSampleGenerationItems(),
  })

  // One exam at J+10 (local midnight) linked to the TL subject.
  const examId = crypto.randomUUID()
  const examDate = localMidnight(now.getFullYear(), now.getMonth(), now.getDate() + 10)
  await tx
    .insert(exam)
    .values({ id: examId, userId, title: 'Partiel — Théorie des langages', date: examDate })
  await tx.insert(examSubject).values({ examId, subjectId: subjTLId })

  // LAST, and in the SAME transaction as everything above: the marker is what
  // makes a session "seeded", so it must become visible at the same instant as
  // the data it describes. No reader can ever observe a half-seeded account.
  await writeDemoMarker(tx, userId, marker)
}
