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
    // Aggregate card totals for every deck in one request (Phase 7 §2.2) —
    // replaces the per-deck `limit=1` probe fan-out on the Subjects screens.
    cardCountsAll: ['decks', 'card-counts'] as const,
  },
  cards: {
    all: ['cards'] as const,
    listByDeck: (deckId: string) => ['cards', 'list', { deckId }] as const,
    detail: (cardId: string) => ['cards', 'detail', cardId] as const,
  },
  dueCounts: {
    all: ['due-counts'] as const,
  },
  planning: {
    all: ['planning'] as const,
    // `range` = { from, to } local day keys of the visible grid window.
    plan: (range: { from: string; to: string }) => ['planning', 'plan', range] as const,
    // "What to review today" (live dues × exam proximity).
    today: ['planning', 'today'] as const,
  },
  exams: {
    all: ['exams'] as const,
    list: ['exams', 'list'] as const,
    detail: (examId: string) => ['exams', 'detail', examId] as const,
  },
  notes: {
    all: ['notes'] as const,
    // `subjectId` absent → every note; `null` → only the "Sans matière" group.
    list: (opts: { subjectId?: string | null }) => ['notes', 'list', opts] as const,
    detail: (noteId: string) => ['notes', 'detail', noteId] as const,
  },
  generations: {
    all: ['generations'] as const,
    listByNote: (noteId: string) => ['generations', 'list', { noteId }] as const,
    detail: (generationId: string) => ['generations', 'detail', generationId] as const,
  },
  ai: {
    // Config + per-provider status (invalidated after every set/delete/update).
    settings: ['ai', 'settings'] as const,
    // Selectable models for a provider (ollama /api/tags, openrouter /models).
    models: (provider: string) => ['ai', 'models', provider] as const,
  },
  analytics: {
    // Everything under `analytics` — a session's end invalidates this prefix.
    all: ['analytics'] as const,
    // Streaks are NOT window-scoped (a running fact), so no window in the key.
    streaks: ['analytics', 'streaks'] as const,
    // The heatmap is a CALENDAR (a whole year), never a windowed aggregate.
    heatmap: (year: number) => ['analytics', 'heatmap', year] as const,
    // The three windowed series/rates. `w` is the AnalyticsWindow preset.
    volume: (w: string) => ['analytics', 'volume', w] as const,
    studyTime: (w: string) => ['analytics', 'study-time', w] as const,
    retention: (w: string) => ['analytics', 'retention', w] as const,
    // Deltas vs the previous equivalent period (tiles). Null for `all`.
    deltas: (w: string) => ['analytics', 'deltas', w] as const,
  },
  review: {
    /**
     * Frozen queue (spec §13.1). `now` (the session's frozen `sessionNow`)
     * enters the key, so every session entry is its own lot and two sessions
     * never share a cached queue.
     */
    queue: (scope: { deckId?: string; subjectId?: string; now: string }) =>
      ['review', 'queue', scope] as const,
    /**
     * Interval preview of a card at a given `now` (finding #5). `now` MUST be in
     * the key: two prefetches of the same card at different `now` would
     * otherwise collide and the second be silently dropped.
     */
    preview: (cardId: string, now: string) => ['review', 'preview', cardId, now] as const,
  },
} as const
