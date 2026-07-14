import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useCoarsePointer } from '@/lib/use-media-query'
import { useT, usePlural } from '@/lib/i18n'
import { MarkdownPreview } from '@/lib/markdown-preview'

export interface CardComposerHandle {
  focus: () => void
}

/** Auto-grow a textarea between a min and max height as its content changes. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

/**
 * Quick-add composer (spec §4 — the reigning interaction). `⌘/Ctrl+Enter`
 * validates → optimistic prepend (handled by `onAdd`) → clears both fields →
 * refocuses RECTO, so a 20-card salvo runs without touching the mouse. A
 * discreet "+N ajoutées" counter tracks the salvo and resets after inactivity.
 * `Esc` blurs back to the table.
 */
export function CardComposer({
  onAdd,
  ref,
}: {
  onAdd: (front: string, back: string) => void
  ref?: Ref<CardComposerHandle>
}) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [errors, setErrors] = useState<{ front: boolean; back: boolean }>({
    front: false,
    back: false,
  })
  const [added, setAdded] = useState(0)
  const [preview, setPreview] = useState(false)
  const coarse = useCoarsePointer()
  const t = useT()
  const plural = usePlural()

  const frontRef = useRef<HTMLTextAreaElement>(null)
  const backRef = useRef<HTMLTextAreaElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => frontRef.current?.focus(),
  }))

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const submit = useCallback(() => {
    const f = front.trim()
    const b = back.trim()
    const nextErrors = { front: f.length === 0, back: b.length === 0 }
    if (nextErrors.front || nextErrors.back) {
      setErrors(nextErrors)
      return
    }
    onAdd(f, b)
    setFront('')
    setBack('')
    setErrors({ front: false, back: false })
    autoGrow(frontRef.current)
    autoGrow(backRef.current)
    frontRef.current?.focus()
    setAdded((n) => n + 1)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setAdded(0), 4000)
  }, [front, back, onAdd])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      ;(e.target as HTMLElement).blur()
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3" onKeyDown={onKeyDown}>
      <Field
        label={t('composer.front')}
        error={errors.front}
        textareaRef={frontRef}
        value={front}
        onChange={(v) => {
          setFront(v)
          if (errors.front) setErrors((e) => ({ ...e, front: false }))
          autoGrow(frontRef.current)
        }}
        placeholder={t('composer.frontPlaceholder')}
        autoFocus
      />

      <div className="mt-3">
        <Field
          label={t('composer.back')}
          error={errors.back}
          textareaRef={backRef}
          value={back}
          onChange={(v) => {
            setBack(v)
            if (errors.back) setErrors((e) => ({ ...e, back: false }))
            autoGrow(backRef.current)
          }}
          placeholder={t('composer.backPlaceholder')}
        />
        {preview && back.trim().length > 0 && (
          <div className="mt-2 rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text">
            <MarkdownPreview source={back} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-text-muted"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? <EyeOff /> : <Eye />}
          {t('composer.markdown')}
        </Button>

        {/* Keyboard cheat-sheet — hidden on touch, where it is inoperative
            noise (fix-session §3). */}
        {!coarse && (
          <span className="flex items-center gap-1.5 text-2xs text-text-faint">
            <Kbd>⌘↵</Kbd> {t('composer.addContinue')}
            <span className="text-border-strong">·</span>
            <Kbd>esc</Kbd>
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          {added > 0 && (
            <span className="font-mono text-xs tabular-nums text-text-faint" aria-live="polite">
              {t(`composer.added_${plural(added)}`, { count: added })}
            </span>
          )}
          <Button type="button" onClick={submit}>
            {t('composer.add')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  value,
  onChange,
  placeholder,
  textareaRef,
  autoFocus,
}: {
  label: string
  error: boolean
  value: string
  onChange: (v: string) => void
  placeholder: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-14 w-full resize-none rounded-sm border bg-bg px-3 py-2 text-sm text-text',
          'placeholder:text-text-faint transition-colors duration-fast',
          error ? 'border-danger' : 'border-border hover:border-border-strong',
        )}
      />
      {error && <p className="text-2xs text-danger">{t('composer.required')}</p>}
    </div>
  )
}
