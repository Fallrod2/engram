/**
 * Deterministic, rich demo dataset for the landing product captures. Emits a
 * v1 `Backup` payload (POST /api/backup/import) so the screenshots always show
 * the same dense, believable state: three subjects, decks + cards in mixed FSRS
 * states, ~60 days of review history (feeds the heatmap / retention / study-time
 * / streak / recent-activity), two upcoming exams, and a couple of generations
 * for the import history. Pure — no I/O — so it is reproducible.
 *
 * `now` is injected so callers can freeze the clock; the capture script passes
 * `new Date()` so "today" is always populated.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Backup } from '@engram/shared'

const DAY = 86_400_000

/** Last drizzle migration tag — the import 409-guards on a schema mismatch. */
function currentSchemaTag(): string {
  const journalPath = fileURLToPath(
    new URL('../apps/server/drizzle/meta/_journal.json', import.meta.url),
  )
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
  const tag = journal.entries.at(-1)?.tag
  if (!tag) throw new Error('no migration entries in drizzle journal')
  return tag
}

function serverAppVersion(): string {
  const pkgPath = fileURLToPath(new URL('../apps/server/package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  return pkg.version ?? '0.0.0'
}

/** Tiny deterministic PRNG (mulberry32) so the dataset never drifts. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Subj {
  id: string
  name: string
  color: string
  icon: string
}

const SUBJECTS: Subj[] = [
  { id: 'sub-tdl', name: 'Théorie des langages', color: '#6366F1', icon: 'braces' },
  { id: 'sub-archi', name: 'Architecture', color: '#14B8A6', icon: 'cpu' },
  { id: 'sub-anglais', name: 'Anglais', color: '#F59E0B', icon: 'languages' },
]

const DECKS: { id: string; subjectId: string; name: string }[] = [
  { id: 'deck-automates', subjectId: 'sub-tdl', name: 'Automates finis' },
  { id: 'deck-grammaires', subjectId: 'sub-tdl', name: 'Grammaires' },
  { id: 'deck-pipeline', subjectId: 'sub-archi', name: 'Pipeline & caches' },
  { id: 'deck-irregulars', subjectId: 'sub-anglais', name: 'Irregular verbs' },
]

const CARD_TEXT: Record<string, [string, string][]> = {
  'deck-automates': [
    [
      'Qu’est-ce qu’un AFD ?',
      'Un automate fini **déterministe** : une seule transition par (état, symbole).',
    ],
    [
      'Différence AFD / AFN ?',
      'L’AFN autorise plusieurs transitions et des ε-transitions ; expressivité identique.',
    ],
    [
      'Théorème de Kleene ?',
      'Langages réguliers = langages reconnus par automates finis = décrits par expressions rationnelles.',
    ],
    [
      'Lemme de l’étoile ?',
      'Tout langage régulier infini a un facteur pompable : $xy^iz \\in L$ pour tout $i \\ge 0$.',
    ],
    [
      'Déterminisation ?',
      'Construction des sous-ensembles : chaque état de l’AFD = un ensemble d’états de l’AFN.',
    ],
  ],
  'deck-grammaires': [
    [
      'Grammaire hors-contexte ?',
      'Règles de la forme $A \\to \\alpha$ où $A$ est un non-terminal.',
    ],
    ['Forme normale de Chomsky ?', 'Règles $A \\to BC$ ou $A \\to a$ ; toute GHC s’y ramène.'],
    [
      'Ambiguïté ?',
      'Une grammaire est ambiguë si un mot admet deux arbres de dérivation distincts.',
    ],
  ],
  'deck-pipeline': [
    ['Étages classiques d’un pipeline ?', 'IF, ID, EX, MEM, WB — cinq étages du pipeline RISC.'],
    [
      'Aléa de données ?',
      'Une instruction lit un registre pas encore écrit par une précédente. Résolu par *forwarding*.',
    ],
    ['Cache write-back ?', 'On n’écrit en mémoire qu’à l’éviction du bloc modifié (bit *dirty*).'],
    [
      'Localité spatiale ?',
      'Les adresses proches d’un accès récent seront probablement accédées bientôt.',
    ],
  ],
  'deck-irregulars': [
    ['to think', 'thought / thought'],
    ['to bring', 'brought / brought'],
    ['to seek', 'sought / sought'],
    ['to teach', 'taught / taught'],
  ],
}

export function buildSeedBackup(now: Date = new Date()): Backup {
  const rand = rng(42)
  const iso = (t: number) => new Date(t).toISOString()
  const t0 = now.getTime()

  const subject = SUBJECTS.map((s, i) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    icon: s.icon,
    position: i,
    archived: false,
    createdAt: iso(t0 - 70 * DAY),
    updatedAt: iso(t0 - 70 * DAY),
  }))

  const deck = DECKS.map((d, i) => ({
    id: d.id,
    subjectId: d.subjectId,
    name: d.name,
    description: null,
    position: i,
    createdAt: iso(t0 - 68 * DAY),
    updatedAt: iso(t0 - 68 * DAY),
  }))

  const card: Backup['tables']['card'] = []
  const reviewLog: Backup['tables']['reviewLog'] = []

  let cardN = 0
  let logN = 0
  for (const d of DECKS) {
    const texts = CARD_TEXT[d.id] ?? []
    texts.forEach(([front, back], idx) => {
      const id = `card-${d.id}-${idx}`
      cardN++
      // Spread due dates: ~half due today/overdue (dashboard + session), rest future.
      const dueOffset = idx % 2 === 0 ? -Math.floor(rand() * 2) * DAY : (1 + idx) * DAY
      const reps = 2 + Math.floor(rand() * 8)
      const lapses = Math.floor(rand() * 2)
      const lastReviewT = t0 - (1 + Math.floor(rand() * 3)) * DAY
      card.push({
        id,
        deckId: d.id,
        front,
        back,
        due: iso(t0 + dueOffset),
        stability: 3 + rand() * 20,
        difficulty: 4 + rand() * 3,
        elapsedDays: 1 + Math.floor(rand() * 5),
        scheduledDays: 1 + Math.floor(rand() * 12),
        learningSteps: 0,
        reps,
        lapses,
        state: 2, // Review
        lastReview: iso(lastReviewT),
        createdAt: iso(t0 - 60 * DAY),
        updatedAt: iso(lastReviewT),
      })

      // Historical review logs for this card, scattered over ~60 days.
      const nLogs = 4 + Math.floor(rand() * 8)
      for (let k = 0; k < nLogs; k++) {
        const daysAgo = Math.floor(rand() * 60)
        const reviewT = t0 - daysAgo * DAY - Math.floor(rand() * 12) * 3_600_000
        // Mostly "Good" (3), some Again/Hard/Easy → retention ~85%.
        const r = rand()
        const rating = r < 0.12 ? 1 : r < 0.24 ? 2 : r < 0.85 ? 3 : 4
        reviewLog.push({
          id: `log-${logN++}`,
          cardId: id,
          rating,
          state: 2,
          due: iso(reviewT + (1 + Math.floor(rand() * 12)) * DAY),
          stability: 2 + rand() * 20,
          difficulty: 4 + rand() * 3,
          elapsedDays: Math.floor(rand() * 10),
          lastElapsedDays: Math.floor(rand() * 10),
          scheduledDays: 1 + Math.floor(rand() * 12),
          learningSteps: 0,
          review: iso(reviewT),
          durationMs: 2_000 + Math.floor(rand() * 9_000),
          createdAt: iso(reviewT),
        })
      }
    })
  }

  // Guarantee an unbroken recent streak incl. today (dashboard streak + activity).
  for (let dch = 0; dch < 9; dch++) {
    const reviewT = t0 - dch * DAY - 3_600_000
    reviewLog.push({
      id: `log-streak-${dch}`,
      cardId: `card-${DECKS[0]!.id}-0`,
      rating: 3,
      state: 2,
      due: iso(reviewT + 5 * DAY),
      stability: 8,
      difficulty: 5,
      elapsedDays: 3,
      lastElapsedDays: 3,
      scheduledDays: 5,
      learningSteps: 0,
      review: iso(reviewT),
      durationMs: 4_000 + Math.floor(rand() * 4_000),
      createdAt: iso(reviewT),
    })
  }

  const note: Backup['tables']['note'] = [
    {
      id: 'note-automates',
      subjectId: 'sub-tdl',
      title: 'Automates finis — chapitre 3',
      sourceType: 'md',
      originalFilename: 'automates-ch3.md',
      content:
        '# Automates finis\n\nUn **automate fini déterministe** (AFD) est un quintuplet ' +
        '$(Q, \\Sigma, \\delta, q_0, F)$.\n\n## Déterminisation\n\nConstruction des sous-ensembles…',
      createdAt: iso(t0 - 5 * DAY),
      updatedAt: iso(t0 - 5 * DAY),
    },
  ]

  const generation: Backup['tables']['generation'] = [
    {
      id: 'gen-1',
      noteId: 'note-automates',
      deckId: 'deck-automates',
      kind: 'cards',
      status: 'succeeded',
      model: 'claude-sonnet-4-6',
      items: [
        {
          id: 'gi-1',
          front: 'Qu’est-ce qu’un AFD ?',
          back: 'Déterministe.',
          status: 'accepted',
          cardId: 'card-deck-automates-0',
        },
        {
          id: 'gi-2',
          front: 'Déterminisation ?',
          back: 'Sous-ensembles.',
          status: 'accepted',
          cardId: 'card-deck-automates-4',
        },
        { id: 'gi-3', front: 'Redondant', back: '…', status: 'rejected' },
      ],
      promptTokens: 820,
      completionTokens: 240,
      error: null,
      createdAt: iso(t0 - 2 * 3_600_000),
      updatedAt: iso(t0 - 2 * 3_600_000),
    },
    {
      id: 'gen-2',
      noteId: 'note-automates',
      deckId: 'deck-grammaires',
      kind: 'quiz',
      status: 'succeeded',
      model: 'claude-sonnet-4-6',
      items: [
        {
          id: 'gq-1',
          front: 'Chomsky ?',
          back: 'FNC.',
          status: 'accepted',
          cardId: 'card-deck-grammaires-1',
        },
      ],
      promptTokens: 610,
      completionTokens: 150,
      error: null,
      createdAt: iso(t0 - 26 * 3_600_000),
      updatedAt: iso(t0 - 26 * 3_600_000),
    },
  ]

  const exam: Backup['tables']['exam'] = [
    {
      id: 'exam-partiel',
      title: 'Partiel TDL',
      date: iso(t0 + 6 * DAY),
      notes: null,
      createdAt: iso(t0 - 10 * DAY),
      updatedAt: iso(t0 - 10 * DAY),
    },
    {
      id: 'exam-archi',
      title: 'DS Architecture',
      date: iso(t0 + 13 * DAY),
      notes: null,
      createdAt: iso(t0 - 10 * DAY),
      updatedAt: iso(t0 - 10 * DAY),
    },
  ]

  const examSubject = [
    { examId: 'exam-partiel', subjectId: 'sub-tdl' },
    { examId: 'exam-archi', subjectId: 'sub-archi' },
  ]

  void cardN

  return {
    engramBackup: 1,
    exportedAt: iso(t0),
    appVersion: serverAppVersion(),
    schema: currentSchemaTag(),
    tables: { subject, deck, card, reviewLog, note, generation, exam, examSubject },
  }
}
