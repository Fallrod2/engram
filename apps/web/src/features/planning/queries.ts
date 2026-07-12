import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  examSchema,
  studyPlanResponseSchema,
  studyTodayResponseSchema,
  type CreateExam,
  type Exam,
  type UpdateExam,
} from '@engram/shared'
import { api, qs } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { mergeDefined } from '@/lib/utils'

const examListSchema = z.array(examSchema)

/**
 * Projected review load over the visible day window — `GET /api/study-plan`.
 * Dues "mature" over time and the window granularity is a day, so we refetch on
 * focus (not on an interval). The live "today" number comes from `dueCounts`,
 * not from here.
 */
export function studyPlanOptions(range: { from: string; to: string }) {
  return queryOptions({
    queryKey: qk.planning.plan(range),
    queryFn: ({ signal }) =>
      api.get(
        `/study-plan${qs({ from: range.from, to: range.to })}`,
        studyPlanResponseSchema,
        signal,
      ),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Prioritized "what to review today" — `GET /api/study-plan/today`. */
export function studyTodayOptions() {
  return queryOptions({
    queryKey: qk.planning.today,
    queryFn: ({ signal }) => api.get('/study-plan/today', studyTodayResponseSchema, signal),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Every exam — one cache serves both the calendar (exams of the window) and the
 * upcoming list (filtered `date >= today` client-side), avoiding a second fetch.
 */
export function examsListOptions() {
  return queryOptions({
    queryKey: qk.exams.list,
    queryFn: ({ signal }) => api.get('/exams', examListSchema, signal),
  })
}

export function examDetailOptions(examId: string) {
  return queryOptions({
    queryKey: qk.exams.detail(examId),
    queryFn: ({ signal }) => api.get(`/exams/${examId}`, examSchema, signal),
  })
}

const LIST_KEY = qk.exams.list

/** Sort exams chronologically (date asc, then title) — the display order. */
function sortExams(list: Exam[]): Exam[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}

export function useCreateExam() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: CreateExam) => api.post('/exams', input, examSchema),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Exam[]>(LIST_KEY)
      const now = new Date().toISOString()
      const optimistic: Exam = {
        id: `optimistic:${crypto.randomUUID()}`,
        title: input.title,
        date: input.date,
        notes: input.notes ?? null,
        subjectIds: input.subjectIds,
        createdAt: now,
        updatedAt: now,
      }
      qc.setQueryData<Exam[]>(LIST_KEY, (old) => sortExams([...(old ?? []), optimistic]))
      return { previous, tempId: optimistic.id }
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error("Création de l'examen échouée", {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(input) },
      })
    },
    onSuccess: (created, _input, ctx) => {
      qc.setQueryData<Exam[]>(LIST_KEY, (old) =>
        sortExams((old ?? []).map((e) => (e.id === ctx?.tempId ? created : e))),
      )
    },
    // An exam is a deadline, never a card → it moves no load: invalidate exams only.
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.exams.all }),
  })
  return mutation
}

export function useUpdateExam() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateExam }) =>
      api.patch(`/exams/${id}`, patch, examSchema),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Exam[]>(LIST_KEY)
      qc.setQueryData<Exam[]>(LIST_KEY, (old) =>
        sortExams((old ?? []).map((e) => (e.id === id ? mergeDefined(e, patch) : e))),
      )
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error("Modification de l'examen échouée", {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: qk.exams.all })
      void qc.invalidateQueries({ queryKey: qk.exams.detail(vars.id) })
    },
  })
  return mutation
}

export function useDeleteExam() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete(`/exams/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Exam[]>(LIST_KEY)
      qc.setQueryData<Exam[]>(LIST_KEY, (old) => (old ?? []).filter((e) => e.id !== id))
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error("Suppression de l'examen échouée", {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.exams.all }),
  })
  return mutation
}
