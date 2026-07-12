/**
 * Normalized query keys (spec §1.2). The single source of every cache key —
 * never inline a key array in a component or feature. Each feature colocates
 * `queryOptions()` that combine one of these keys with its `queryFn`.
 */
export const qk = {
  subjects: {
    all: ['subjects'] as const,
    list: (opts: { includeArchived: boolean }) => ['subjects', 'list', opts] as const,
    detail: (subjectId: string) => ['subjects', 'detail', subjectId] as const,
  },
  decks: {
    all: ['decks'] as const,
    listBySubject: (subjectId: string) => ['decks', 'list', { subjectId }] as const,
    detail: (deckId: string) => ['decks', 'detail', deckId] as const,
    cardCount: (deckId: string) => ['decks', 'card-count', deckId] as const,
  },
  cards: {
    all: ['cards'] as const,
    listByDeck: (deckId: string) => ['cards', 'list', { deckId }] as const,
    detail: (cardId: string) => ['cards', 'detail', cardId] as const,
  },
  dueCounts: {
    all: ['due-counts'] as const,
  },
} as const
