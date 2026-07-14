import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Note, Subject, UpdateNote } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { EntityFormDialog } from '@/components/entity-form-dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubjectDot } from '@/components/subject-dot'

/** Radix Select forbids an empty value → sentinel for the "Sans matière" option. */
const NO_SUBJECT = '__none__'

const noteFormSchema = z.object({
  title: z.string().trim().min(1, 'forms.titleRequired'),
  subjectId: z.string(),
})

type NoteFormValues = z.infer<typeof noteFormSchema>

/** Rename a note and (re)assign its subject (spec §3.1). */
export function NoteEditDialog({
  open,
  onOpenChange,
  note,
  subjects,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  note: Note
  subjects: Subject[]
  onSubmit: (patch: UpdateNote) => void
}) {
  const t = useT()
  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: initial(note),
  })

  useEffect(() => {
    if (open) form.reset(initial(note))
  }, [open, note, form])

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dialogs.noteEdit')}
      form={form}
      onSubmit={(values) =>
        onSubmit({
          title: values.title.trim(),
          subjectId: values.subjectId === NO_SUBJECT ? null : values.subjectId,
        })
      }
      contentClassName="max-w-md"
    >
      <FormField
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.title')}</FormLabel>
            <FormControl>
              <Input autoFocus className={cn(fieldState.error && 'border-danger')} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="subjectId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('forms.subject')}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger aria-label={t('forms.subject')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUBJECT}>{t('forms.noSubjectOption')}</SelectItem>
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
          </FormItem>
        )}
      />
    </EntityFormDialog>
  )
}

function initial(note: Note): NoteFormValues {
  return { title: note.title, subjectId: note.subjectId ?? NO_SUBJECT }
}
