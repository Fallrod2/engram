import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  generationSchema,
  listGenerationsResponseSchema,
  type Generation,
  type ResolveGeneration,
  type StartGeneration,
} from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/** Poll cadence while a generation is `pending` (spec §1.4). */
const POLL_MS = 1500

/** Generations of one note, newest first — `GET /api/generations?noteId=`. */
export function generationsByNoteOptions(noteId: string) {
  return queryOptions({
    queryKey: qk.generations.listByNote(noteId),
    queryFn: async ({ signal }) => {
      const res = await api.get(
        `/generations?noteId=${noteId}`,
        listGenerationsResponseSchema,
        signal,
      )
      return res.generations
    },
    staleTime: 15_000,
  })
}

/**
 * Every generation (all notes) — used by the Import list to show a per-note
 * count without a request per row. One list query, grouped client-side.
 */
export function allGenerationsOptions() {
  return queryOptions({
    queryKey: qk.generations.all,
    queryFn: async ({ signal }) => {
      const res = await api.get('/generations', listGenerationsResponseSchema, signal)
      return res.generations
    },
    staleTime: 15_000,
  })
}

/** Index generations into a `noteId → count` lookup. */
export function generationCountByNote(generations: Generation[] | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of generations ?? []) m.set(g.noteId, (m.get(g.noteId) ?? 0) + 1)
  return m
}

/**
 * A single generation, with **conditional polling** (spec §1.4): while its
 * status is `pending` we refetch every 1.5s; the interval stops the instant it
 * becomes `succeeded`/`failed`. Paused when the tab is hidden. `staleTime: 0`
 * so a refresh mid-`pending` re-reads the live state.
 */
export function generationDetailOptions(generationId: string) {
  return queryOptions({
    queryKey: qk.generations.detail(generationId),
    queryFn: ({ signal }) => api.get(`/generations/${generationId}`, generationSchema, signal),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
    refetchIntervalInBackground: false,
    staleTime: 0,
  })
}

/**
 * Launch a generation (`POST /api/generations` → 202 `pending`). The caller
 * navigates to the generation URL on success; here we prime the detail cache
 * and refresh the note's history. A missing API key surfaces as a
 * `service_unavailable` `ApiError` — handled by the caller (banner, no navigate).
 */
export function useStartGeneration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: StartGeneration) => api.post('/generations', input, generationSchema),
    onSuccess: (created) => {
      qc.setQueryData<Generation>(qk.generations.detail(created.id), created)
      void qc.invalidateQueries({ queryKey: qk.generations.listByNote(created.noteId) })
    },
  })
}

/**
 * Resolve a generation (`POST /api/generations/:id/resolve`) — inserts the
 * accepted/edited items as cards. Invalidates exactly like "create card"
 * (spec §1.5): every cards/decks/subjects query + the sidebar due counts (the
 * inserted cards are New → due now). Not optimistic on the card list (the
 * server assigns the `cardId`s); the screen shows an "inserting…" state.
 */
export function useResolveGeneration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: ResolveGeneration['items'] }) =>
      api.post(`/generations/${id}/resolve`, { items }, generationSchema),
    onSuccess: (resolved) => {
      qc.setQueryData<Generation>(qk.generations.detail(resolved.id), resolved)
      void qc.invalidateQueries({ queryKey: qk.generations.listByNote(resolved.noteId) })
      // "create card" matrix — prefix invalidation covers listByDeck/cardCount/
      // listBySubject/detail under each root key.
      void qc.invalidateQueries({ queryKey: qk.cards.all })
      void qc.invalidateQueries({ queryKey: qk.decks.all })
      void qc.invalidateQueries({ queryKey: qk.subjects.all })
      void qc.invalidateQueries({ queryKey: qk.dueCounts.all })
    },
  })
}
