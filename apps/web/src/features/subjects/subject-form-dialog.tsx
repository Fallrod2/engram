import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createSubjectSchema, type CreateSubject, type Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import { EntityFormDialog } from '@/components/entity-form-dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { SubjectDot } from '@/components/subject-dot'
import { SubjectIconPicker } from '@/components/subject-icon'
import { SUBJECT_PIGMENTS, DEFAULT_PIGMENT } from '@/lib/pigments'

/**
 * Form schema derived from the shared `createSubjectSchema` (single source of the
 * color/icon rules); only the `name` message is localized. Validation is the RHF
 * Zod resolver — no hand-rolled rules.
 */
const subjectFormSchema = createSubjectSchema
  .pick({ name: true, color: true, icon: true })
  .extend({ name: z.string().trim().min(1, 'Le nom est requis.') })

type SubjectFormValues = z.infer<typeof subjectFormSchema>

/** Create/edit a subject (spec §2). `⌘/Ctrl+Enter` submits, `Esc` closes. */
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
  const form = useForm<SubjectFormValues>({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: initial(subject),
  })

  // Reset whenever the dialog (re)opens for a given subject.
  useEffect(() => {
    if (open) form.reset(initial(subject))
  }, [open, subject, form])

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={subject ? 'Modifier la matière' : 'Nouvelle matière'}
      form={form}
      onSubmit={onSubmit}
      contentClassName="max-w-md"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>Nom</FormLabel>
            <div className="flex items-center gap-2">
              <FormField
                control={form.control}
                name="icon"
                render={({ field: iconField }) => (
                  <SubjectIconPicker value={iconField.value} onChange={iconField.onChange} />
                )}
              />
              <FormControl>
                <Input
                  autoFocus
                  placeholder="ex. Théorie des langages"
                  className={cn(fieldState.error && 'border-danger')}
                  {...field}
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="color"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Couleur</FormLabel>
            <div
              role="radiogroup"
              aria-label="Couleur de la matière"
              className="flex items-center gap-1.5"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const idx = SUBJECT_PIGMENTS.findIndex((p) => p.hex === field.value)
                const delta = e.key === 'ArrowRight' ? 1 : -1
                const next =
                  SUBJECT_PIGMENTS[
                    (idx + delta + SUBJECT_PIGMENTS.length) % SUBJECT_PIGMENTS.length
                  ]
                if (next) field.onChange(next.hex)
              }}
            >
              {SUBJECT_PIGMENTS.map((p) => {
                const selected = p.hex === field.value
                return (
                  <button
                    key={p.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => field.onChange(p.hex)}
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
          </FormItem>
        )}
      />
    </EntityFormDialog>
  )
}

function initial(subject?: Subject): SubjectFormValues {
  return {
    name: subject?.name ?? '',
    color: subject?.color ?? DEFAULT_PIGMENT.hex,
    icon: subject?.icon ?? 'BookOpen',
  }
}
