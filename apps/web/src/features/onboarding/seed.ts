import type { QueryClient } from '@tanstack/react-query'
import { cardSchema, deckSchema, subjectSchema } from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { DEFAULT_PIGMENT } from '@/lib/pigments'

/** Six simple FR front/back pairs — enough to start a session immediately. */
const DEMO_CARDS: readonly { front: string; back: string }[] = [
  { front: 'Capitale de la France', back: 'Paris' },
  { front: "Capitale de l'Italie", back: 'Rome' },
  { front: 'Année de la chute du mur de Berlin', back: '1989' },
  { front: 'Nombre de continents', back: 'Sept' },
  { front: "Symbole chimique de l'or", back: 'Au' },
  { front: 'Auteur des « Misérables »', back: 'Victor Hugo' },
]

/**
 * Client-side demo seed (spec §6.4): a subject + deck + 6 New cards via the
 * existing endpoints (no new server route). New cards are due now, so the
 * dashboard flips to the populated state and a session is immediately runnable.
 * Best-effort: no cross-endpoint transaction (acceptable for a demo seed).
 */
export async function seedExample(qc: QueryClient): Promise<void> {
  const subject = await api.post(
    '/subjects',
    { name: 'Démo : Culture générale', color: DEFAULT_PIGMENT.hex, icon: 'BookOpen' },
    subjectSchema,
  )
  const deck = await api.post('/decks', { subjectId: subject.id, name: 'Bases' }, deckSchema)
  for (const c of DEMO_CARDS) {
    await api.post('/cards', { deckId: deck.id, front: c.front, back: c.back }, cardSchema)
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.subjects.all }),
    qc.invalidateQueries({ queryKey: qk.decks.all }),
    qc.invalidateQueries({ queryKey: qk.dueCounts.all }),
    qc.invalidateQueries({ queryKey: qk.planning.all }),
  ])
}
