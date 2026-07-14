import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createDeckSchema, type Deck } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { EntityFormDialog } from '@/components/entity-form-dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * Derived from the shared `createDeckSchema` (name rule) with a localized
 * message; `description` is a plain (controlled) string. `subjectId` is implicit
 * (route param) and not edited here.
 */
const deckFormSchema = createDeckSchema.pick({ name: true, description: true }).extend({
  name: z.string().trim().min(1, 'forms.nameRequired'),
  description: z.string(),
})

export type DeckFormValues = z.infer<typeof deckFormSchema>

/** Create/edit a deck (spec §3). `⌘/Ctrl+Enter` submits. */
export function DeckFormDialog({
  open,
  onOpenChange,
  deck,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deck?: Deck
  onSubmit: (values: DeckFormValues) => void
}) {
  const t = useT()
  const form = useForm<DeckFormValues>({
    resolver: zodResolver(deckFormSchema),
    defaultValues: initial(deck),
  })

  useEffect(() => {
    if (open) form.reset(initial(deck))
  }, [open, deck, form])

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={deck ? t('dialogs.deckEdit') : t('dialogs.deckNew')}
      form={form}
      onSubmit={(values) => onSubmit({ name: values.name, description: values.description.trim() })}
      contentClassName="max-w-md"
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.name')}</FormLabel>
            <FormControl>
              <Input
                autoFocus
                placeholder={t('forms.deckPlaceholder')}
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
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('forms.description')}</FormLabel>
            <FormControl>
              <Textarea placeholder={t('forms.optional')} className="min-h-16" {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </EntityFormDialog>
  )
}

function initial(deck?: Deck): DeckFormValues {
  return { name: deck?.name ?? '', description: deck?.description ?? '' }
}
