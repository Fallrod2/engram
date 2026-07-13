import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  listNotesResponseSchema,
  noteSchema,
  type CreateNote,
  type Note,
  type UpdateNote,
} from '@engram/shared'
import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { mergeDefined } from '@/lib/utils'

/**
 * All imported notes (spec §2) — `GET /api/notes` → `{ notes }`. We keep one
 * list cache and derive the per-subject grouping (incl. the "Sans matière"
 * group) client-side, so an optimistic import or a subject change only ever
 * touches one array.
 */
export function notesListOptions() {
  return queryOptions({
    queryKey: qk.notes.list({}),
    queryFn: async ({ signal }) => {
      const res = await api.get('/notes', listNotesResponseSchema, signal)
      return res.notes
    },
    staleTime: 30_000,
  })
}

export function noteDetailOptions(noteId: string) {
  return queryOptions({
    queryKey: qk.notes.detail(noteId),
    queryFn: ({ signal }) => api.get(`/notes/${noteId}`, noteSchema, signal),
    staleTime: 30_000,
  })
}

const LIST_KEY = qk.notes.list({})

/** Build the multipart body for an upload (spec §1.3, `POST /api/notes/upload`). */
export function buildUploadForm(file: File, subjectId?: string): FormData {
  const form = new FormData()
  form.set('file', file)
  if (subjectId) form.set('subjectId', subjectId)
  return form
}

/**
 * Import a document (multipart). Extraction is synchronous server-side, so the
 * mutation resolving IS "extraction done". The Import screen owns the optimistic
 * "importing…" row (a local `File`-bearing state that supports retry), so this
 * mutation only prepends the real note into the list cache on success and
 * invalidates on settle.
 */
export function useUploadNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, subjectId }: { file: File; subjectId?: string }) =>
      api.upload('/notes/upload', buildUploadForm(file, subjectId), noteSchema),
    onSuccess: (created) => {
      qc.setQueryData<Note[]>(LIST_KEY, (old) => [created, ...(old ?? [])])
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notes.all }),
  })
}

/**
 * Create a note from JSON (OCR spec §3.4 — the corrected photo transcription,
 * `sourceType: 'image'`). Aligned on `useUploadNote`: prepend into the list
 * cache on success, invalidate on settle. The pasted-text importer can reuse it.
 */
export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateNote) => api.post('/notes', input, noteSchema),
    onSuccess: (created) => {
      qc.setQueryData<Note[]>(LIST_KEY, (old) => [created, ...(old ?? [])])
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notes.all }),
  })
}

/** Rename / re-file a note (subject or title). */
export function useUpdateNote() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateNote }) =>
      api.patch(`/notes/${id}`, patch, noteSchema),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      await qc.cancelQueries({ queryKey: qk.notes.detail(id) })
      const previousList = qc.getQueryData<Note[]>(LIST_KEY)
      const previousDetail = qc.getQueryData<Note>(qk.notes.detail(id))
      qc.setQueryData<Note[]>(LIST_KEY, (old) =>
        (old ?? []).map((n) => (n.id === id ? mergeDefined(n, patch) : n)),
      )
      qc.setQueryData<Note>(qk.notes.detail(id), (old) => (old ? mergeDefined(old, patch) : old))
      return { previousList, previousDetail }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previousList) qc.setQueryData(LIST_KEY, ctx.previousList)
      if (ctx?.previousDetail) qc.setQueryData(qk.notes.detail(vars.id), ctx.previousDetail)
      toast.error('Modification de la note échouée', {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: qk.notes.detail(vars.id) })
      void qc.invalidateQueries({ queryKey: qk.notes.all })
    },
  })
  return mutation
}

/** Delete a note (cascades to its generations server-side). */
export function useDeleteNote() {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete(`/notes/${id}`),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<Note[]>(LIST_KEY)
      qc.setQueryData<Note[]>(LIST_KEY, (old) => (old ?? []).filter((n) => n.id !== id))
      return { previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(LIST_KEY, ctx.previous)
      toast.error('Suppression de la note échouée', {
        action: { label: 'Réessayer', onClick: () => mutation.mutate(vars) },
      })
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: qk.notes.all })
      void qc.invalidateQueries({ queryKey: qk.generations.listByNote(vars.id) })
    },
  })
  return mutation
}
