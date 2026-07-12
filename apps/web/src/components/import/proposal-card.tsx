import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { Markdown } from '@/components/markdown'
import type { ReviewItem } from '@/features/generations/review-machine'

/** Status glyph — monochrome + luminance, never a rating hue (spec §5). */
function StatusGlyph({ status }: { status: ReviewItem['status'] }) {
  if (status === 'rejected') {
    return (
      <span className="relative inline-block size-3" aria-hidden>
        <span className="absolute inset-0 rounded-xs border border-border-strong" />
        <span className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 rotate-45 bg-text-faint" />
      </span>
    )
  }
  if (status === 'accepted' || status === 'edited') {
    return <span className="inline-block size-3 rounded-xs bg-text" aria-hidden />
  }
  // pending → hollow ring
  return <span className="inline-block size-3 rounded-xs border border-border-strong" aria-hidden />
}

/**
 * One AI proposal (spec §4.3). Rendered recto/verso via `<Markdown>` (the card
 * as it will be reviewed), monochrome status glyph, cursor = `surface-2` + a 2px
 * accent left bar. Edit mode swaps in two textareas (`⌘↵` validate, `Esc`
 * cancel, `Tab` recto↔verso); both fields must be non-empty.
 */
export function ProposalCard({
  item,
  index,
  cursorActive,
  editing,
  readOnly = false,
  deckLink,
  rowProps,
  onAccept,
  onReject,
  onEdit,
  onUndo,
  onStartEdit,
  onCancelEdit,
}: {
  item: ReviewItem
  index: number
  cursorActive: boolean
  editing: boolean
  readOnly?: boolean
  /** In the resolved read-only view, an inserted card links to its deck. */
  deckLink?: {
    to: '/subjects/$subjectId/decks/$deckId'
    params: { subjectId: string; deckId: string }
  }
  rowProps: React.HTMLAttributes<HTMLElement> & { tabIndex: number }
  onAccept: () => void
  onReject: () => void
  onEdit: (front: string, back: string) => void
  onUndo: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
}) {
  const rejected = item.status === 'rejected'

  return (
    <article
      {...rowProps}
      className={cn(
        'group relative rounded-md border px-4 py-3 outline-none transition-colors duration-fast',
        'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-full before:bg-accent before:opacity-0 before:transition-opacity',
        'focus-visible:shadow-[var(--shadow-focus)]',
        cursorActive
          ? 'border-border-strong bg-surface-2 before:opacity-100'
          : 'border-border bg-surface-1',
        rejected && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex shrink-0 items-center gap-2">
          <StatusGlyph status={item.status} />
          <span className="font-mono text-xs tabular-nums text-text-faint">
            {String(index).padStart(2, '0')}
          </span>
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <ProposalEditor item={item} onSave={onEdit} onCancel={onCancelEdit} />
          ) : (
            <div className="flex flex-col gap-2">
              <Face label="Recto" struck={rejected}>
                <Markdown source={item.front} />
              </Face>
              <Face label="Verso" muted struck={rejected}>
                <Markdown source={item.back} />
              </Face>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {item.status === 'edited' && (
            <span className="rounded-xs bg-surface-3 px-1 font-mono text-2xs text-text-muted">
              modifié
            </span>
          )}
          {item.frozen && deckLink && (
            <Link
              to={deckLink.to}
              params={deckLink.params}
              className="text-2xs text-accent underline-offset-2 hover:underline"
            >
              voir dans le deck
            </Link>
          )}
        </div>
      </div>

      {/* Action legend — visible on hover/focus, hidden while editing / read-only. */}
      {!editing && !readOnly && (
        <div
          className={cn(
            'mt-2 flex items-center gap-2 text-2xs text-text-faint transition-opacity duration-fast',
            cursorActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex items-center gap-1 hover:text-text-muted"
          >
            <Kbd>a</Kbd> accepter
          </button>
          <button
            type="button"
            onClick={onStartEdit}
            className="inline-flex items-center gap-1 hover:text-text-muted"
          >
            <Kbd>e</Kbd> éditer
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1 hover:text-text-muted"
          >
            <Kbd>r</Kbd> rejeter
          </button>
          {item.history.length > 0 && (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex items-center gap-1 hover:text-text-muted"
            >
              <Kbd>u</Kbd> annuler
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function Face({
  label,
  muted,
  struck,
  children,
}: {
  label: string
  muted?: boolean
  struck?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {label}
      </span>
      <div
        className={cn(
          'text-sm',
          muted ? 'text-text-muted' : 'text-text',
          struck && 'text-text-faint line-through',
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Inline recto/verso editor (spec §4.4). */
function ProposalEditor({
  item,
  onSave,
  onCancel,
}: {
  item: ReviewItem
  onSave: (front: string, back: string) => void
  onCancel: () => void
}) {
  const [front, setFront] = useState(item.front)
  const [back, setBack] = useState(item.back)
  const [touched, setTouched] = useState(false)
  const frontRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    frontRef.current?.focus()
    frontRef.current?.select()
  }, [])

  const frontEmpty = front.trim() === ''
  const backEmpty = back.trim() === ''

  function save() {
    setTouched(true)
    if (frontEmpty || backEmpty) return
    onSave(front.trim(), back.trim())
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      // stopPropagation so the same ⌘↵ can't also reach the board's window
      // hotkey and open the insertion confirm — the keystroke stays local.
      e.preventDefault()
      e.stopPropagation()
      save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
      <EditorField
        label="Recto"
        value={front}
        onChange={setFront}
        error={touched && frontEmpty}
        textareaRef={frontRef}
      />
      <EditorField label="Verso" value={back} onChange={setBack} error={touched && backEmpty} />
      <div className="flex items-center gap-2 text-2xs text-text-faint">
        <span className="inline-flex items-center gap-1">
          <Kbd>⌘↵</Kbd> valider
        </span>
        <span className="text-border-strong">·</span>
        <span className="inline-flex items-center gap-1">
          <Kbd>esc</Kbd> annuler
        </span>
      </div>
    </div>
  )
}

function EditorField({
  label,
  value,
  onChange,
  error,
  textareaRef,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error: boolean
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error || undefined}
        aria-label={label}
        className={cn(
          'min-h-14 w-full resize-none rounded-sm border bg-bg px-3 py-2 text-sm text-text',
          'placeholder:text-text-faint transition-colors duration-fast',
          error ? 'border-danger' : 'border-border hover:border-border-strong',
        )}
      />
      {error && <p className="text-2xs text-danger">Ce champ est requis.</p>}
    </div>
  )
}
