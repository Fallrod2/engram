import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { subjectSchema, type CreateSubject, type Subject, type UpdateSubject } from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { mergeDefined } from '@/lib/utils'

const subjectListSchema = z.array(subjectSchema)

/**
 * All subjects, archived included (spec §2). We keep a single list cache and
 * derive Active/Archived views + the sidebar list client-side, so optimistic
 * updates only ever touch one array.
 */
export function subjectsListOptions() {
  return queryOptions({
    queryKey: qk.subjects.list({ includeArchived: true }),
    queryFn: ({ signal }) => api.get('/subjects?includeArchived=true', subjectListSchema, signal),
  })
}

export function subjectDetailOptions(subjectId: string) {
  return queryOptions({
    queryKey: qk.subjects.detail(subjectId),
    queryFn: ({ signal }) => api.get(`/subjects/${subjectId}`, subjectSchema, signal),
  })
}

const LIST_KEY = qk.subjects.list({ includeArchived: true })

function patchList(list: Subject[] | undefined, fn: (l: Subject[]) => Subject[]): Subject[] {
  return fn(list ?? [])
}

/** Optimistic mutation scaffold shared by every subject write. */
function useSubjectListMutation<Vars>(config: {
  mutationFn: (vars: Vars) => Promise<Subject | void>
  optimistic: (list: Subject[], vars: Vars) => Subject[]
  errorTitle: string
  invalidateDueCounts?: boolean
  invalidateDecks?: boolean
}) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: config.mutationFn,
    onMutate: async (vars: Vars) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Subject[]>(LIST_KEY)
      qc.setQueryData<Subject[]>(LIST_KEY, (old) =>
        patchList(old, (l) => config.optimistic(l, vars)),
      )
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error(config.errorTitle, {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.subjects.all })
      if (config.invalidateDueCounts) void qc.invalidateQueries({ queryKey: qk.dueCounts.all })
      if (config.invalidateDecks) void qc.invalidateQueries({ queryKey: qk.decks.all })
    },
  })
  return mutation
}

export function useCreateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSubject) => api.post('/subjects', input, subjectSchema),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Subject[]>(LIST_KEY)
      const now = new Date().toISOString()
      const maxPos = (previous ?? []).reduce((m, s) => Math.max(m, s.position), 0)
      const optimistic: Subject = {
        id: `optimistic:${crypto.randomUUID()}`,
        name: input.name,
        color: input.color,
        icon: input.icon,
        position: input.position ?? maxPos + 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
      }
      qc.setQueryData<Subject[]>(LIST_KEY, (old) => [optimistic, ...(old ?? [])])
      return { previous, tempId: optimistic.id }
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error('Création de la matière échouée', {
        action: {
          label: 'Réessayer',
          onClick: () => void api.post('/subjects', input, subjectSchema),
        },
      })
    },
    onSuccess: (created, _input, ctx) => {
      // Replace the temp row with the server row (same position in the list).
      qc.setQueryData<Subject[]>(LIST_KEY, (old) =>
        (old ?? []).map((s) => (s.id === ctx?.tempId ? created : s)),
      )
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.subjects.all }),
  })
}

export function useUpdateSubject() {
  return useSubjectListMutation<{ id: string; patch: UpdateSubject }>({
    mutationFn: ({ id, patch }) => api.patch(`/subjects/${id}`, patch, subjectSchema),
    optimistic: (list, { id, patch }) =>
      list.map((s) => (s.id === id ? mergeDefined(s, patch) : s)),
    errorTitle: 'Modification de la matière échouée',
  })
}

export function useArchiveSubject() {
  return useSubjectListMutation<{ id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) =>
      api.post(`/subjects/${id}/${archived ? 'archive' : 'unarchive'}`, undefined, subjectSchema),
    optimistic: (list, { id, archived }) => list.map((s) => (s.id === id ? { ...s, archived } : s)),
    errorTitle: 'Archivage échoué',
    invalidateDueCounts: true,
  })
}

export function useDeleteSubject() {
  return useSubjectListMutation<{ id: string }>({
    mutationFn: ({ id }) => api.delete(`/subjects/${id}`),
    optimistic: (list, { id }) => list.filter((s) => s.id !== id),
    errorTitle: 'Suppression de la matière échouée',
    invalidateDueCounts: true,
    invalidateDecks: true,
  })
}
