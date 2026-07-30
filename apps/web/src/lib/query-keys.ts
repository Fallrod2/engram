/**
 * Normalized query keys (spec §1.2). The single source of every cache key —
 * never inline a key array in a component or feature. Each feature colocates
 * `queryOptions()` that combine one of these keys with its `queryFn`.
 */
export const qk = {
  /** The caller's own identity (`GET /api/me`) — drives the guard + admin nav. */
  me: ['me'] as const,
  /**
   * Public server capabilities (`GET /api/health`). Read by the landing to learn,
   * AT RUNTIME, whether the demo login is configured — so enabling the demo is a
   * server env change with no front-end redeploy.
   */
  health: ['health'] as const,
  admin: {
    all: ['admin'] as const,
    users: (q: { query: string | undefined; page: number; sort: string; dir: string }) =>
      ['admin', 'users', q] as const,
    userDetail: (userId: string) => ['admin', 'user', userId] as const,
    stats: ['admin', 'stats'] as const,
    audit: (page: number) => ['admin', 'audit', page] as const,
    groups: ['admin', 'groups'] as const,
    groupMembers: (groupId: string) => ['admin', 'groups', groupId, 'members'] as const,
  },
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
  /**
   * Content search (`GET /api/cards/search`, T-030).
   *
   * NOT under `cards`: the deck list and a search answer the same table but not
   * the same question, and folding them under one prefix would make a card
   * create in one deck invalidate every cached search page — including the ⌘K
   * results the user is looking at while they type. Each write invalidates
   * `cardSearch.all` explicitly instead.
   *
   * The WHOLE request shape is in the key, needle included, because that is
   * precisely what makes a late response harmless: it lands in its own entry
   * instead of over the current one.
   */
  cardSearch: {
    all: ['card-search'] as const,
    results: (params: Record<string, string | number | boolean | undefined>) =>
      ['card-search', 'results', params] as const,
    /**
     * Size of the WHOLE corpus, from the same endpoint with no needle and
     * `limit=1`. One cheap row, and it is the only thing that tells "no card
     * matches this search" apart from "this account has no cards".
     */
    corpusSize: ['card-search', 'corpus-size'] as const,
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
  /**
   * Daily pacing (`GET /api/study-settings`). NOT window-scoped and NOT keyed by
   * `now`: the response carries a `today` block the server computes from its own
   * clock, so a key carrying the browser's would only fragment the cache and
   * strand the value the session screen just wrote.
   */
  studySettings: ['study-settings'] as const,
  /** First-run journey marker (`GET /api/onboarding`) — one row, one key. */
  onboarding: ['onboarding'] as const,
  ai: {
    // Config + per-provider status (invalidated after every set/delete/update).
    settings: ['ai', 'settings'] as const,
    // Selectable models for a provider (ollama /api/tags, openrouter /models).
    models: (provider: string) => ['ai', 'models', provider] as const,
  },
  analytics: {
    // Everything under `analytics` — a session's end invalidates this prefix.
    all: ['analytics'] as const,
    // Streaks are NOT window-scoped (a running fact), so no window in the key —
    // and NOT subject-scoped either: the endpoint takes no `subjectId` at all
    // (a streak is a habit of the person). See `streaksQuerySchema`.
    streaks: ['analytics', 'streaks'] as const,
    /**
     * `subjectId` is part of every key below because it is part of the REQUEST:
     * "all subjects" and "this subject" are two different answers, and sharing a
     * key would serve one for the other. `undefined` (all) keys distinctly from
     * any id, so the unfiltered screen keeps its own cache entry.
     */
    // The heatmap is a CALENDAR (a whole year), never a windowed aggregate.
    heatmap: (year: number, subjectId?: string) =>
      ['analytics', 'heatmap', year, { subjectId }] as const,
    // The three windowed series/rates. `w` is the AnalyticsWindow preset.
    volume: (w: string, subjectId?: string) => ['analytics', 'volume', w, { subjectId }] as const,
    studyTime: (w: string, subjectId?: string) =>
      ['analytics', 'study-time', w, { subjectId }] as const,
    retention: (w: string, subjectId?: string) =>
      ['analytics', 'retention', w, { subjectId }] as const,
    // Success rate per deck over the window — only ever read per subject (the
    // Subject screen), where it ranks THAT subject's decks.
    deckSuccess: (w: string, subjectId?: string) =>
      ['analytics', 'deck-success', w, { subjectId }] as const,
    // Deltas vs the previous equivalent period (tiles). Null for `all`.
    deltas: (w: string, subjectId?: string) => ['analytics', 'deltas', w, { subjectId }] as const,
    // Hardest cards per subject. NOT window-scoped (FSRS difficulty is a current
    // state, not a period aggregate) — only the per-subject `limit` keys it.
    hardestCards: (limit: number, subjectId?: string) =>
      ['analytics', 'hardest-cards', limit, { subjectId }] as const,
    /**
     * Exam readiness. NOT window-scoped: it is a FORECAST of memory at a future
     * instant, not an aggregate over a past period, so no window belongs in the
     * key. `now` is not in it either — the client freezes one `now` per screen
     * and the projection moves by minutes, not by keystrokes.
     */
    examReadiness: (subjectId?: string) => ['analytics', 'exam-readiness', { subjectId }] as const,
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
    /**
     * Strict PREFIX of `preview(cardId, now)` — every cached preview of a card,
     * all `now` confounded. It is a PURGE handle, never a key to fetch with: an
     * undo unwinds the card's FSRS state, so every interval already computed for
     * it describes a card that no longer exists and must leave the cache.
     */
    previewsFor: (cardId: string) => ['review', 'preview', cardId] as const,
  },
} as const
