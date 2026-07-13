import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ImageOff, RefreshCw, TriangleAlert, X } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { Markdown } from '@/components/markdown'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SubjectDot } from '@/components/subject-dot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCreateNote } from '@/features/notes/queries'
import { useExtractImage } from './queries'
import { classifyExtractError, describeExtractError } from './errors'
import { getExtractionConcurrency, initOcrState, ocrReducer } from './state'

const NO_SUBJECT = '__none__'

interface PhotoItem {
  id: string
  file: File
  name: string
  url: string
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Bounded-concurrency pool (OCR spec §3.3.2). */
async function runPool<T>(
  list: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let cursor = 0
  const lanes = Math.max(1, Math.min(concurrency, list.length))
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (cursor < list.length) {
        const item = list[cursor++]
        if (item) await worker(item)
      }
    }),
  )
}

/**
 * Photo → note preview/correction screen (OCR spec §3.3). Each photo is
 * downscaled + OCR'd independently (pooled), the segments are assembled into one
 * editable Markdown (freeze rule in `state.ts`), then a single note is created
 * with `sourceType: 'image'` and handed to the existing generation flow.
 *
 * Props-driven so the flow is testable without the route/store.
 */
export function PhotoImport({
  files,
  subjectId,
  subjects,
}: {
  files: File[]
  subjectId?: string
  subjects: Subject[]
}) {
  const navigate = useNavigate()

  const [items] = useState<PhotoItem[]>(() =>
    files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      url: URL.createObjectURL(f),
    })),
  )
  const urlById = useMemo(() => new Map(items.map((it) => [it.id, it.url])), [items])

  const [state, dispatch] = useReducer(ocrReducer, items, (its) =>
    initOcrState(its.map((i) => ({ id: i.id, name: i.name }))),
  )
  const [title, setTitle] = useState(() => baseName(files[0]?.name ?? 'Cours'))
  const [subject, setSubject] = useState(subjectId ?? NO_SUBJECT)
  const [providerError, setProviderError] = useState(false)

  const extract = useExtractImage()
  const extractMut = extract.mutateAsync
  const createNote = useCreateNote()

  const runOne = useCallback(
    async (item: PhotoItem) => {
      try {
        const res = await extractMut(item.file)
        dispatch({ type: 'resolved', id: item.id, segment: res.markdown, warnings: res.warnings })
      } catch (e) {
        if (classifyExtractError(e) === 'noVisionProvider') setProviderError(true)
        dispatch({ type: 'failed', id: item.id, error: describeExtractError(e) })
      }
    },
    [extractMut],
  )

  // Kick off the extractions once.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void runPool(items, runOne, getExtractionConcurrency())
  }, [items, runOne])

  // Revoke object URLs on unmount only.
  useEffect(() => () => items.forEach((it) => URL.revokeObjectURL(it.url)), [items])

  function retry(id: string) {
    const item = items.find((it) => it.id === id)
    if (!item) return
    dispatch({ type: 'retryStart', id })
    void runOne(item)
  }

  function remove(id: string) {
    dispatch({ type: 'remove', id })
  }

  const canCreate = state.assembledText.trim().length > 0 && !createNote.isPending
  const allFailed = state.pages.length > 0 && state.pages.every((p) => p.status === 'error')

  function create() {
    const content = state.assembledText.trim()
    if (!content) return
    const originalFilename =
      items.length === 1 ? (items[0]?.name ?? null) : `cours (${items.length} photos)`
    createNote.mutate(
      {
        title: title.trim() || 'Cours',
        sourceType: 'image',
        ...(originalFilename ? { originalFilename } : {}),
        content,
        ...(subject !== NO_SUBJECT ? { subjectId: subject } : {}),
      },
      {
        onSuccess: (note) => void navigate({ to: '/import/$noteId', params: { noteId: note.id } }),
        onError: () =>
          toast.error('Création de la note impossible', {
            action: { label: 'Réessayer', onClick: () => create() },
          }),
      },
    )
  }

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to="/import" className="text-text-muted transition-colors hover:text-text">
            Import
          </Link>
        }
        title="Import photo"
      />

      {providerError && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning-subtle px-4 py-3">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text">Aucun modèle de vision configuré</p>
              <p className="text-xs leading-relaxed text-text-muted">
                L’extraction photo a besoin d’un fournisseur IA compatible vision (Claude, GPT-4o,
                llava…).
              </p>
              <div className="mt-1">
                <Button asChild variant="secondary" size="sm">
                  <Link to="/settings">Configurer un fournisseur</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Pages column */}
        <div className="flex flex-col gap-2">
          <p className="px-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
            Pages ({state.pages.length})
          </p>
          <ul className="flex flex-col gap-2">
            {state.pages.map((page, i) => (
              <li
                key={page.id}
                className="flex items-start gap-2 rounded-md border border-border bg-surface-1 p-2"
              >
                <img
                  src={urlById.get(page.id)}
                  alt=""
                  className="size-14 shrink-0 rounded-sm border border-border object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-xs text-text" title={page.name}>
                    {page.name}
                  </span>
                  {page.status === 'pending' && <Skeleton className="h-3 w-24" />}
                  {page.status === 'done' && page.warnings.length > 0 && (
                    <Badge variant="warning" className="w-fit gap-1">
                      <TriangleAlert className="size-3" aria-hidden />
                      {page.warnings.join(' · ')}
                    </Badge>
                  )}
                  {page.status === 'done' && page.warnings.length === 0 && (
                    <span className="text-2xs text-success">extraite</span>
                  )}
                  {page.status === 'error' && (
                    <span className="text-2xs text-danger">{page.error ?? 'échec'}</span>
                  )}
                  <div className="mt-0.5 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-text-faint"
                      aria-label="Monter la page"
                      disabled={i === 0}
                      onClick={() => dispatch({ type: 'move', id: page.id, dir: -1 })}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-text-faint"
                      aria-label="Descendre la page"
                      disabled={i === state.pages.length - 1}
                      onClick={() => dispatch({ type: 'move', id: page.id, dir: 1 })}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    {page.status !== 'pending' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-text-faint"
                        aria-label="Réextraire cette page"
                        onClick={() => retry(page.id)}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-6 text-text-faint hover:text-danger"
                      aria-label="Supprimer la page"
                      onClick={() => remove(page.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor column */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ocr-title">Titre</Label>
              <Input
                id="ocr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titre de la note"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Matière</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger aria-label="Ranger dans une matière">
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
          </div>

          {state.staleSinceEdit && (
            <div className="flex items-center gap-3 rounded-md border border-info/30 bg-info-subtle px-3 py-2">
              <p className="flex-1 text-xs text-text-muted">
                De nouvelles pages ont été extraites depuis votre dernière correction.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dispatch({ type: 'reapplyOrder' })}
              >
                Réappliquer l’ordre
              </Button>
            </div>
          )}

          {allFailed ? (
            <EmptyState
              icon={ImageOff}
              title="Aucune page n’a pu être transcrite"
              meta="Réessayez une page, ou revenez à l’import."
            />
          ) : (
            <Tabs defaultValue="edit">
              <TabsList>
                <TabsTrigger value="edit">Éditer</TabsTrigger>
                <TabsTrigger value="preview">Aperçu</TabsTrigger>
              </TabsList>
              <TabsContent value="edit">
                <Textarea
                  aria-label="Texte transcrit"
                  className="min-h-[45vh] font-mono text-xs leading-relaxed"
                  value={state.assembledText}
                  onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
                  placeholder="La transcription apparaîtra ici au fil des pages…"
                />
              </TabsContent>
              <TabsContent value="preview">
                <div className="min-h-[45vh] rounded-sm border border-border bg-surface-1 p-4">
                  {state.assembledText.trim() ? (
                    <Markdown source={state.assembledText} />
                  ) : (
                    <p className="text-sm text-text-faint">Rien à prévisualiser pour l’instant.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="ghost">
              <Link to="/import">Annuler</Link>
            </Button>
            <Button onClick={create} disabled={!canCreate}>
              Créer la note
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
