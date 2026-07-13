import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Note, Subject } from '@engram/shared'
import { EmptyState } from '@/components/empty-state'
import { useT } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { ImportIllustration } from '@/components/illustrations'
import { ImportSkeleton } from '@/components/skeletons'
import { SubjectDot } from '@/components/subject-dot'
import { ConfirmDelete } from '@/components/confirm-delete'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dropzone,
  hasAcceptedExtension,
  isHeicFile,
  isImageFile,
  MAX_UPLOAD_BYTES,
} from '@/components/import/dropzone'
import { setPendingPhotos } from '@/features/ocr/pending'
import { NoteRow } from '@/components/import/note-row'
import { ImportingRow } from '@/components/import/importing-row'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { subjectsListOptions } from '@/features/subjects/queries'
import {
  notesListOptions,
  useDeleteNote,
  useUpdateNote,
  useUploadNote,
} from '@/features/notes/queries'
import { allGenerationsOptions, generationCountByNote } from '@/features/generations/queries'
import { NoteEditDialog } from '@/features/notes/note-edit-dialog'
import { describeUploadError } from '@/features/generations/errors'

const NO_SUBJECT = '__none__'
/** Client-side cap on photos per batch (OCR spec §1.2, cost guard §0.2.1). */
const MAX_PHOTOS = 10

export const Route = createFileRoute('/import/')({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(notesListOptions()),
      context.queryClient.ensureQueryData(subjectsListOptions()),
      context.queryClient.ensureQueryData(allGenerationsOptions()),
    ]),
  component: ImportPage,
  pendingComponent: () => <ImportSkeleton />,
  errorComponent: ImportError,
})

function ImportError() {
  const router = useRouter()
  return <ErrorState kind="notes" onRetry={() => void router.invalidate()} />
}

interface UploadRow {
  id: string
  file: File
  subjectId: string | undefined
  status: 'importing' | 'error'
  error?: string
}

interface SubjectGroup {
  key: string
  subject: Subject | null
  notes: Note[]
}

function ImportPage() {
  const navigate = useNavigate()
  const t = useT()
  const notes = useQuery(notesListOptions()).data ?? []
  const subjects = useQuery(subjectsListOptions()).data ?? []
  const generations = useQuery(allGenerationsOptions()).data

  const upload = useUploadNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [fileInSubject, setFileInSubject] = useState<string>(NO_SUBJECT)
  const [editNote, setEditNote] = useState<Note | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null)

  const genCounts = useMemo(() => generationCountByNote(generations), [generations])

  // Group notes by subject (ordered), then a terminal "Sans matière" group.
  const groups = useMemo<SubjectGroup[]>(() => {
    const sorted = [...subjects].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    )
    const byId = new Map<string, Note[]>()
    const orphans: Note[] = []
    for (const n of notes) {
      if (n.subjectId === null) orphans.push(n)
      else byId.set(n.subjectId, [...(byId.get(n.subjectId) ?? []), n])
    }
    const out: SubjectGroup[] = []
    for (const s of sorted) {
      const ns = byId.get(s.id)
      if (ns && ns.length > 0) out.push({ key: s.id, subject: s, notes: sortNotes(ns) })
    }
    if (orphans.length > 0) out.push({ key: NO_SUBJECT, subject: null, notes: sortNotes(orphans) })
    return out
  }, [notes, subjects])

  // Flat, ordered list of visible notes — drives roving + keyboard.
  const flatNotes = useMemo(() => groups.flatMap((g) => g.notes), [groups])
  const roving = useRovingList<HTMLAnchorElement>(flatNotes.length, (i) => {
    const n = flatNotes[i]
    if (n) void navigate({ to: '/import/$noteId', params: { noteId: n.id } })
  })
  const activeNote = flatNotes[roving.active]

  function startUpload(file: File, subjectId: string | undefined) {
    const id = crypto.randomUUID()
    setUploads((prev) => [...prev, { id, file, subjectId, status: 'importing' }])
    upload.mutate(
      { file, ...(subjectId ? { subjectId } : {}) },
      {
        onSuccess: () => {
          setUploads((prev) => prev.filter((u) => u.id !== id))
        },
        onError: (err) => {
          const message = describeUploadError(err)
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, status: 'error', error: message } : u)),
          )
          toast.error('Import impossible', { description: file.name })
        },
      },
    )
  }

  function onFiles(files: File[]) {
    const subjectId = fileInSubject === NO_SUBJECT ? undefined : fileInSubject
    const images: File[] = []
    for (const file of files) {
      // HEIC/HEIF (iPhone default) is rejected with an actionable message BEFORE
      // the generic check — neither the vision APIs nor the canvas downscale can
      // decode it (§1.1). Reuse the shared client-side classification/message.
      if (isHeicFile(file.name)) {
        toast.error(t('ocr.error.heic'), { description: file.name })
        continue
      }
      if (!hasAcceptedExtension(file.name)) {
        toast.error('Type de fichier non supporté', {
          description: `${file.name} — .md, .pdf ou photo`,
        })
        continue
      }
      // Photos take the OCR preview flow; their size is validated AFTER the
      // client downscale (§3.2), never rejected raw here.
      if (isImageFile(file.name)) {
        images.push(file)
        continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error('Fichier trop volumineux', { description: `${file.name} — max 10 Mo` })
        continue
      }
      startUpload(file, subjectId)
    }
    if (images.length > 0) {
      const capped = images.slice(0, MAX_PHOTOS)
      if (images.length > MAX_PHOTOS) {
        toast.error(t('ocr.tooManyPhotos'), {
          description: t('ocr.tooManyPhotosDetail', { max: MAX_PHOTOS }),
        })
      }
      setPendingPhotos({ files: capped, ...(subjectId ? { subjectId } : {}) })
      void navigate({ to: '/import/photo' })
    }
  }

  useHotkeys({
    e: (e) => {
      e.preventDefault()
      if (activeNote) setEditNote(activeNote)
    },
    x: (e) => {
      e.preventDefault()
      if (activeNote) setDeleteTarget(activeNote)
    },
    backspace: (e) => {
      e.preventDefault()
      if (activeNote) setDeleteTarget(activeNote)
    },
  })

  const isEmpty = notes.length === 0 && uploads.length === 0

  return (
    <div>
      <Dropzone onFiles={onFiles}>
        <div className="flex items-center justify-center gap-2 text-xs text-text-faint">
          <span>Ranger dans</span>
          <Select value={fileInSubject} onValueChange={setFileInSubject}>
            <SelectTrigger className="h-7 w-48" aria-label="Ranger les imports dans une matière">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUBJECT}>Sans matière</SelectItem>
              {subjects
                .filter((s) => !s.archived)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-1.5">
                      <SubjectDot color={s.color} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </Dropzone>

      <div className="mt-6">
        {uploads.length > 0 && (
          <div className="mb-4 flex flex-col gap-1">
            {uploads.map((u) => (
              <ImportingRow
                key={u.id}
                filename={u.file.name}
                status={u.status}
                {...(u.error ? { error: u.error } : {})}
                onRetry={() => {
                  setUploads((prev) => prev.filter((x) => x.id !== u.id))
                  startUpload(u.file, u.subjectId)
                }}
                onRemove={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
              />
            ))}
          </div>
        )}

        {isEmpty ? (
          <EmptyState
            illustration={<ImportIllustration />}
            title={t('empty.importTitle')}
            meta={t('empty.importMeta')}
          />
        ) : (
          <ul className="flex flex-col gap-6" onKeyDown={roving.onKeyDown}>
            {groups.map((group) => (
              <li key={group.key}>
                <div className="mb-1 flex items-center gap-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
                  {group.subject ? (
                    <>
                      <SubjectDot color={group.subject.color} />
                      {group.subject.name}
                    </>
                  ) : (
                    'Sans matière'
                  )}
                </div>
                <ul className="flex flex-col">
                  {group.notes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      generationCount={genCounts.get(note.id) ?? 0}
                      rowProps={roving.getItemProps(flatNotes.indexOf(note))}
                      onEdit={setEditNote}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editNote && (
        <NoteEditDialog
          open={editNote !== null}
          onOpenChange={(o) => !o && setEditNote(null)}
          note={editNote}
          subjects={subjects}
          onSubmit={(patch) => updateNote.mutate({ id: editNote.id, patch })}
        />
      )}
      <ConfirmDelete
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Supprimer « ${deleteTarget?.title} » ?`}
        description="Supprime cette note et toutes ses générations. Les cartes déjà insérées ne sont pas touchées. Irréversible."
        onConfirm={() => deleteTarget && deleteNote.mutate({ id: deleteTarget.id })}
      />
    </div>
  )
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
