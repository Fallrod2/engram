import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown } from 'lucide-react'
import { z } from 'zod'
import type { CreateExam, Exam, UpdateExam } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { parseDayKey } from '@/lib/calendar'
import { EntityFormDialog } from '@/components/entity-form-dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { SubjectDot } from '@/components/subject-dot'
import { subjectsListOptions } from '@/features/subjects/queries'
import { DatePicker } from './date-picker'

const examFormSchema = z.object({
  title: z.string().trim().min(1, 'forms.titleRequired'),
  date: z.date(),
  subjectIds: z.array(z.string()).min(1, 'forms.atLeastOneSubject'),
  notes: z.string(),
})

export type ExamFormValues = z.infer<typeof examFormSchema>

function initial(exam: Exam | undefined, defaultDateKey: string): ExamFormValues {
  return {
    title: exam?.title ?? '',
    date: exam ? new Date(exam.date) : parseDayKey(defaultDateKey),
    subjectIds: exam?.subjectIds ?? [],
    notes: exam?.notes ?? '',
  }
}

/**
 * Create/edit an exam (spec §6.1). RHF + Zod; the shared `create/updateExam`
 * rules are honored (title ≥ 1, ≥ 1 subject) and the local-midnight date is
 * serialized to ISO on submit. `⌘/Ctrl+Enter` submits, `Esc` closes.
 */
export function ExamFormDialog({
  open,
  onOpenChange,
  exam,
  defaultDateKey,
  onCreate,
  onUpdate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  exam?: Exam
  defaultDateKey: string
  onCreate: (input: CreateExam) => void
  onUpdate: (id: string, patch: UpdateExam) => void
}) {
  const t = useT()
  const subjects = (useQuery(subjectsListOptions()).data ?? []).filter((s) => !s.archived)
  const form = useForm<ExamFormValues>({
    resolver: zodResolver(examFormSchema),
    defaultValues: initial(exam, defaultDateKey),
  })

  useEffect(() => {
    if (open) form.reset(initial(exam, defaultDateKey))
  }, [open, exam, defaultDateKey, form])

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={exam ? t('dialogs.examEdit') : t('dialogs.examNew')}
      form={form}
      onSubmit={(values) => {
        const isoDate = values.date.toISOString()
        const notes = values.notes.trim()
        if (exam) {
          onUpdate(exam.id, {
            title: values.title,
            date: isoDate,
            subjectIds: values.subjectIds,
            notes: notes || null,
          })
        } else {
          onCreate({
            title: values.title,
            date: isoDate,
            subjectIds: values.subjectIds,
            ...(notes ? { notes } : {}),
          })
        }
      }}
      contentClassName="max-w-md"
    >
      <FormField
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.title')}</FormLabel>
            <FormControl>
              <Input
                autoFocus
                placeholder={t('forms.examTitlePlaceholder')}
                className={cn(fieldState.error && 'border-danger')}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="date"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.date')}</FormLabel>
            <FormControl>
              <DatePicker
                value={field.value}
                onChange={field.onChange}
                invalid={!!fieldState.error}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="subjectIds"
        render={({ field, fieldState }) => {
          const selected = subjects.filter((s) => field.value.includes(s.id))
          const toggle = (id: string) => {
            field.onChange(
              field.value.includes(id) ? field.value.filter((x) => x !== id) : [...field.value, id],
            )
          }
          return (
            <FormItem>
              <FormLabel>{t('forms.subjects')}</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      type="button"
                      variant="secondary"
                      className={cn('w-full justify-between', fieldState.error && 'border-danger')}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        {selected.length === 0 ? (
                          <span className="text-text-faint">{t('forms.selectSubjects')}</span>
                        ) : (
                          selected.map((s) => (
                            <span key={s.id} className="flex items-center gap-1 text-xs">
                              <SubjectDot color={s.color} />
                              {s.name}
                            </span>
                          ))
                        )}
                      </span>
                      <ChevronsUpDown className="size-4 shrink-0 text-text-muted" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('forms.searchSubject')} />
                    <CommandList>
                      <CommandEmpty>{t('forms.noSubjectResults')}</CommandEmpty>
                      <CommandGroup>
                        {subjects.map((s) => {
                          const isSel = field.value.includes(s.id)
                          return (
                            <CommandItem key={s.id} value={s.name} onSelect={() => toggle(s.id)}>
                              <SubjectDot color={s.color} />
                              <span className="flex-1">{s.name}</span>
                              {isSel && <Check className="size-4 text-accent" />}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )
        }}
      />

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('forms.notes')}</FormLabel>
            <FormControl>
              <Textarea placeholder={t('forms.optional')} className="min-h-16" {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </EntityFormDialog>
  )
}
