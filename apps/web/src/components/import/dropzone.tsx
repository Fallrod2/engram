import { useRef, useState, type ReactNode } from 'react'
import { Camera, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { useCoarsePointer } from '@/lib/use-media-query'

/** Photo extensions (OCR spec §3.1). Downscaled + OCR'd, not uploaded as docs. */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const
/** iPhone default photo formats — rejected with an actionable message (§1.1). */
export const HEIC_EXTENSIONS = ['.heic', '.heif'] as const
/** Accepted upload extensions (docs mirror `detectSourceType` + photos). */
export const ACCEPT_EXTENSIONS = ['.md', '.markdown', '.txt', '.pdf', ...IMAGE_EXTENSIONS] as const
/** Client-side size cap, aligned with the server's 10 MiB limit (docs). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** True iff the filename ends with an accepted extension. */
export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** True iff the filename is a photo routed through the OCR preview flow. */
export function isImageFile(name: string): boolean {
  const lower = name.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * True iff the filename is a HEIC/HEIF photo (iPhone default). Recognized so the
 * caller can surface the actionable HEIC message (§1.1) instead of the generic
 * "unsupported type" toast — the vision APIs and the canvas downscale can't
 * decode it, so it's rejected before any upload.
 */
export function isHeicFile(name: string): boolean {
  const lower = name.toLowerCase()
  return HEIC_EXTENSIONS.some((ext) => lower.endsWith(ext))
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
  const t = useT()
  const coarse = useCoarsePointer()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function pick() {
    if (!disabled) inputRef.current?.click()
  }

  function openCamera() {
    if (!disabled) cameraRef.current?.click()
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
        aria-label={t('ocr.dropzone.aria')}
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
          {t('ocr.dropzone.hintLead')}{' '}
          <span className="font-mono text-xs text-text-muted">.md</span>,{' '}
          <span className="font-mono text-xs text-text-muted">.pdf</span> {t('ocr.dropzone.hintOr')}{' '}
          <span className="text-text">{t('ocr.dropzone.photo')}</span> {t('ocr.dropzone.hintTail')}
        </p>
        {coarse ? (
          // Touch: `↵ pour parcourir` is inoperative and wraps awkwardly at
          // 360px — swap it for a tap-friendly instruction (fix-session §3).
          <p className="text-2xs text-text-faint">
            {t('ocr.dropzone.browseMobile')} · {t('ocr.dropzone.limits')}
          </p>
        ) : (
          <p className="flex items-center justify-center gap-1.5 text-2xs text-text-faint">
            <Kbd>↵</Kbd> {t('ocr.dropzone.browse')}
            <span className="text-border-strong">·</span>
            {t('ocr.dropzone.limits')}
          </p>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            // Own the click so the surrounding dropzone doesn't also open the picker.
            e.stopPropagation()
            openCamera()
          }}
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1 text-xs text-text-muted',
            'transition-colors hover:border-border-strong hover:text-text',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <Camera className="size-3.5" aria-hidden />
          {t('ocr.dropzone.takePhoto')}
        </button>
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
        {/* Distinct capture input: opens the rear camera on mobile; on desktop
            `capture` is ignored and it falls back to the file picker. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            emit(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}
