import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  deckCardCountsSchema,
  deckSchema,
  type CreateDeck,
  type Deck,
  type UpdateDeck,
} from '@engram/shared'
import { api, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { mergeDefined } from '@/lib/utils'

const deckListSchema = z.array(deckSchema)

/** Decks of one subject — `GET /api/decks?subjectId=`. */
export function decksListOptions(subjectId: string) {
  return queryOptions({
    queryKey: qk.decks.listBySubject(subjectId),
    queryFn: ({ signal }) => api.get(`/decks${qs({ subjectId })}`, deckListSchema, signal),
  })
}

/** Every deck — used to derive per-subject deck counts on the Subjects screen. */
export function allDecksOptions() {
  return queryOptions({
    queryKey: qk.decks.all,
    queryFn: ({ signal }) => api.get('/decks', deckListSchema, signal),
  })
}

export function deckDetailOptions(deckId: string) {
  return queryOptions({
    queryKey: qk.decks.detail(deckId),
    queryFn: ({ signal }) => api.get(`/decks/${deckId}`, deckSchema, signal),
  })
}

/**
 * Card totals for every deck in ONE request (Phase 7 §2.2). Returns a
 * `Map<deckId, count>` so screens read `map.get(id) ?? 0` — decks with no cards
 * are absent from the payload and default to 0. This replaces the previous
 * per-deck `limit=1` probe fan-out (O(decks) requests → 1).
 */
export function deckCardCountsOptions() {
  return queryOptions({
    queryKey: qk.decks.cardCountsAll,
    queryFn: async ({ signal }) => {
      const { byDeck } = await api.get('/decks/card-counts', deckCardCountsSchema, signal)
      return new Map(byDeck.map((r) => [r.deckId, r.cardCount] as const))
    },
  })
}

function useDeckMutation<Vars>(
  subjectId: string,
  config: {
    mutationFn: (vars: Vars) => Promise<Deck | void>
    optimistic: (list: Deck[], vars: Vars) => Deck[]
    errorTitle: string
    invalidateDueCounts?: boolean
  },
) {
  const qc = useQueryClient()
  const key = qk.decks.listBySubject(subjectId)
  const mutation = useMutation({
    mutationFn: config.mutationFn,
    onMutate: async (vars: Vars) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Deck[]>(key)
      qc.setQueryData<Deck[]>(key, (old) => config.optimistic(old ?? [], vars))
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error(config.errorTitle, {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: qk.decks.all })
      void qc.invalidateQueries({ queryKey: qk.subjects.all })
      if (config.invalidateDueCounts) {
        void qc.invalidateQueries({ queryKey: qk.dueCounts.all })
        // Deleting a deck removes its cards → the aggregate totals shift.
        void qc.invalidateQueries({ queryKey: qk.decks.cardCountsAll })
      }
    },
  })
  return mutation
}

export function useCreateDeck(subjectId: string) {
  const qc = useQueryClient()
  const key = qk.decks.listBySubject(subjectId)
  const mutation = useMutation({
    mutationFn: (input: CreateDeck) => api.post('/decks', input, deckSchema),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Deck[]>(key)
      const now = new Date().toISOString()
      const maxPos = (previous ?? []).reduce((m, d) => Math.max(m, d.position), 0)
      const optimistic: Deck = {
        id: `optimistic:${crypto.randomUUID()}`,
        subjectId: input.subjectId,
        name: input.name,
        description: input.description ?? null,
        position: maxPos + 1,
        createdAt: now,
        updatedAt: now,
      }
      qc.setQueryData<Deck[]>(key, (old) => [optimistic, ...(old ?? [])])
      return { previous, tempId: optimistic.id }
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error('Création du deck échouée', {
        action: { label: 'Réessayer', onClick: () => void api.post('/decks', input, deckSchema) },
      })
    },
    onSuccess: (created, _input, ctx) => {
      qc.setQueryData<Deck[]>(key, (old) =>
        (old ?? []).map((d) => (d.id === ctx?.tempId ? created : d)),
      )
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: qk.decks.all })
      void qc.invalidateQueries({ queryKey: qk.subjects.all })
    },
  })
  return mutation
}

export function useUpdateDeck(subjectId: string) {
  return useDeckMutation<{ id: string; patch: UpdateDeck }>(subjectId, {
    mutationFn: ({ id, patch }) => api.patch(`/decks/${id}`, patch, deckSchema),
    optimistic: (list, { id, patch }) =>
      list.map((d) => (d.id === id ? mergeDefined(d, patch) : d)),
    errorTitle: 'Modification du deck échouée',
  })
}

export function useDeleteDeck(subjectId: string) {
  return useDeckMutation<{ id: string }>(subjectId, {
    mutationFn: ({ id }) => api.delete(`/decks/${id}`),
    optimistic: (list, { id }) => list.filter((d) => d.id !== id),
    errorTitle: 'Suppression du deck échouée',
    invalidateDueCounts: true,
  })
}
