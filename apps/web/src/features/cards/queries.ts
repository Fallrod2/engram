import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  cardSchema,
  listCardsResponseSchema,
  type Card,
  type CreateCard,
  type FsrsCardState,
  type UpdateCard,
} from '@engram/shared'
import { api, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { mergeDefined } from '@/lib/utils'

/**
 * Cards of a deck. The API is offset-paginated and ordered by createdAt asc;
 * for personal-tool deck sizes we fetch a single page (limit 500) and sort
 * client-side, which keeps optimistic prepend (the composer's core loop) simple.
 */
const CARD_PAGE_LIMIT = 500

export function cardsListOptions(deckId: string) {
  return queryOptions({
    queryKey: qk.cards.listByDeck(deckId),
    queryFn: async ({ signal }) => {
      const page = await api.get(
        `/cards${qs({ deckId, limit: CARD_PAGE_LIMIT })}`,
        listCardsResponseSchema,
        signal,
      )
      return page.cards
    },
  })
}

/** A fresh New-card FSRS state for an optimistic row (due now, reps 0). */
function optimisticFsrs(nowIso: string): FsrsCardState {
  return {
    due: nowIso,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
  }
}

/** Invalidate everything a card create/delete affects (spec §1.4). */
function invalidateCardCounts(
  qc: ReturnType<typeof useQueryClient>,
  deckId: string,
  subjectId: string,
) {
  void qc.invalidateQueries({ queryKey: qk.cards.listByDeck(deckId) })
  // The per-deck totals shown on the Subjects screens now come from one
  // aggregate query (Phase 7 §2.2) — invalidate that single key, not N probes.
  void qc.invalidateQueries({ queryKey: qk.decks.cardCountsAll })
  void qc.invalidateQueries({ queryKey: qk.decks.listBySubject(subjectId) })
  void qc.invalidateQueries({ queryKey: qk.decks.all })
  void qc.invalidateQueries({ queryKey: qk.subjects.all })
  void qc.invalidateQueries({ queryKey: qk.dueCounts.all })
  // A New card is due now → it enters the study-plan's "today" bucket (Phase 4 §1.4).
  void qc.invalidateQueries({ queryKey: qk.planning.all })
}

export function useCreateCard(deckId: string, subjectId: string) {
  const qc = useQueryClient()
  const key = qk.cards.listByDeck(deckId)
  const mutation = useMutation({
    mutationFn: (input: CreateCard) => api.post('/cards', input, cardSchema),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Card[]>(key)
      const now = new Date().toISOString()
      const optimistic: Card = {
        id: `optimistic:${crypto.randomUUID()}`,
        deckId: input.deckId,
        front: input.front,
        back: input.back,
        fsrs: optimisticFsrs(now),
        createdAt: now,
        updatedAt: now,
      }
      qc.setQueryData<Card[]>(key, (old) => [...(old ?? []), optimistic])
      return { previous, tempId: optimistic.id }
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error('Ajout de la carte échoué', {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(input) },
      })
    },
    onSuccess: (created, _input, ctx) => {
      qc.setQueryData<Card[]>(key, (old) =>
        (old ?? []).map((c) => (c.id === ctx?.tempId ? created : c)),
      )
    },
    onSettled: () => invalidateCardCounts(qc, deckId, subjectId),
  })
  return mutation
}

export function useUpdateCard(deckId: string) {
  const qc = useQueryClient()
  const key = qk.cards.listByDeck(deckId)
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCard }) =>
      api.patch(`/cards/${id}`, patch, cardSchema),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Card[]>(key)
      qc.setQueryData<Card[]>(key, (old) =>
        (old ?? []).map((c) => (c.id === id ? mergeDefined(c, patch) : c)),
      )
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error('Modification de la carte échouée', {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    // Editing front/back never touches FSRS state → only the card list moves.
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  })
  return mutation
}

export function useDeleteCard(deckId: string, subjectId: string) {
  const qc = useQueryClient()
  const key = qk.cards.listByDeck(deckId)
  const mutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete(`/cards/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Card[]>(key)
      qc.setQueryData<Card[]>(key, (old) => (old ?? []).filter((c) => c.id !== id))
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error('Suppression de la carte échouée', {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: () => invalidateCardCounts(qc, deckId, subjectId),
  })
  return mutation
}
