import { useEffect, useState } from 'react'
import { createSubjectSchema, type CreateSubject, type Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/ui/kbd'
import { SubjectDot } from '@/components/subject-dot'
import { SubjectIconPicker } from '@/components/subject-icon'
import { SUBJECT_PIGMENTS, DEFAULT_PIGMENT } from '@/lib/pigments'

interface Values {
  name: string
  color: string
  icon: string
}

/**
 * Create/edit a subject (spec §2). RHF-free: validation is the shared
 * `createSubjectSchema` (single source), applied on submit. `⌘/Ctrl+Enter`
 * submits, `Esc` closes, focus lands on the name field.
 */
export function SubjectFormDialog({
  open,
  onOpenChange,
  subject,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present → edit mode. */
  subject?: Subject
  onSubmit: (values: CreateSubject) => void
}) {
  const [values, setValues] = useState<Values>(() => initial(subject))
  const [error, setError] = useState<string | null>(null)

  // Reset whenever the dialog (re)opens for a given subject.
  useEffect(() => {
    if (open) {
      setValues(initial(subject))
      setError(null)
    }
  }, [open, subject])

  function submit() {
    const parsed = createSubjectSchema.safeParse({
      name: values.name.trim(),
      color: values.color,
      icon: values.icon,
    })
    if (!parsed.success) {
      setError('Le nom est requis.')
      return
    }
    onSubmit(parsed.data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{subject ? 'Modifier la matière' : 'Nouvelle matière'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subject-name">Nom</Label>
            <div className="flex items-center gap-2">
              <SubjectIconPicker
                value={values.icon}
                onChange={(icon) => setValues((v) => ({ ...v, icon }))}
              />
              <Input
                id="subject-name"
                autoFocus
                value={values.name}
                onChange={(e) => {
                  setValues((v) => ({ ...v, name: e.target.value }))
                  if (error) setError(null)
                }}
                placeholder="ex. Théorie des langages"
                aria-invalid={error ? true : undefined}
                className={cn(error && 'border-danger')}
              />
            </div>
            {error && <p className="text-2xs text-danger">{error}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Couleur</Label>
            <div
              role="radiogroup"
              aria-label="Couleur de la matière"
              className="flex items-center gap-1.5"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const idx = SUBJECT_PIGMENTS.findIndex((p) => p.hex === values.color)
                const delta = e.key === 'ArrowRight' ? 1 : -1
                const next =
                  SUBJECT_PIGMENTS[
                    (idx + delta + SUBJECT_PIGMENTS.length) % SUBJECT_PIGMENTS.length
                  ]
                if (next) setValues((v) => ({ ...v, color: next.hex }))
              }}
            >
              {SUBJECT_PIGMENTS.map((p) => {
                const selected = p.hex === values.color
                return (
                  <button
                    key={p.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setValues((v) => ({ ...v, color: p.hex }))}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full transition-transform duration-fast',
                      selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface-3',
                    )}
                  >
                    <SubjectDot color={p.hex} className="size-3.5" />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit}>
            Enregistrer{' '}
            <Kbd className="ml-1.5 border-accent-fg/30 bg-transparent text-accent-fg">⌘↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function initial(subject?: Subject): Values {
  return {
    name: subject?.name ?? '',
    color: subject?.color ?? DEFAULT_PIGMENT.hex,
    icon: subject?.icon ?? 'BookOpen',
  }
}
