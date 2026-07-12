import { useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'

/** Accepted upload extensions (mirrors the server's `detectSourceType`). */
export const ACCEPT_EXTENSIONS = ['.md', '.markdown', '.txt', '.pdf'] as const
/** Client-side size cap, aligned with the server's 10 MiB limit. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** True iff the filename ends with an accepted extension. */
export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * Home-made upload zone (spec §1.10 / §2.1) — no library. Focusable
 * (`role="button"`), `Enter`/`Space` open the native picker; drag events give a
 * visible `dragover` state (accent border + subtle fill). Validation (extension,
 * size) is the parent's job (it owns the toast + optimistic row), so every
 * selected file is passed straight through.
 */
export function Dropzone({
  onFiles,
  disabled = false,
  children,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  /** Optional controls rendered under the hint (e.g. "Ranger dans…" select). */
  children?: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function pick() {
    if (!disabled) inputRef.current?.click()
  }

  function emit(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    onFiles(Array.from(fileList))
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label="Déposer ou choisir un fichier à importer"
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pick()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!disabled) emit(e.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center',
          'transition-colors duration-fast outline-none',
          'focus-visible:shadow-[var(--shadow-focus)]',
          disabled
            ? 'cursor-not-allowed border-border bg-surface-1 opacity-60'
            : 'cursor-pointer border-border bg-surface-2 hover:border-border-strong',
          dragOver && !disabled && 'border-accent bg-accent-subtle',
        )}
      >
        <Upload className="size-6 text-text-faint" strokeWidth={1.75} aria-hidden />
        <p className="text-sm text-text">
          Déposez un fichier <span className="font-mono text-xs text-text-muted">.md</span> ou{' '}
          <span className="font-mono text-xs text-text-muted">.pdf</span>, ou cliquez pour choisir
        </p>
        <p className="flex items-center justify-center gap-1.5 text-2xs text-text-faint">
          <Kbd>↵</Kbd> pour parcourir
          <span className="text-border-strong">·</span>
          max 10 Mo
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => {
            emit(e.target.files)
            // Reset so re-selecting the same file fires `change` again.
            e.target.value = ''
          }}
        />
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}
