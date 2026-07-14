import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import type { Card } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { EntityFormDialog } from '@/components/entity-form-dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownPreview } from '@/lib/markdown-preview'

/**
 * Card front/back validation: both required (spec §4). Shares the RHF + Zod
 * resolver plumbing of `EntityFormDialog`. The submitted `{ front, back }` maps
 * to the shared `updateCardSchema` shape and never touches FSRS state.
 */
const cardFormSchema = z.object({
  front: z.string().trim().min(1, 'forms.fieldRequired'),
  back: z.string().trim().min(1, 'forms.fieldRequired'),
})

type CardFormValues = z.infer<typeof cardFormSchema>

/** Edit a card's front/back in a dialog (spec §4). */
export function CardEditDialog({
  open,
  onOpenChange,
  card,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: Card | null
  onSubmit: (values: CardFormValues) => void
}) {
  const t = useT()
  const [preview, setPreview] = useState(false)
  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: { front: '', back: '' },
  })

  useEffect(() => {
    if (open && card) {
      form.reset({ front: card.front, back: card.back })
      setPreview(false)
    }
  }, [open, card, form])

  const back = form.watch('back')

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('dialogs.cardEdit')}
      form={form}
      onSubmit={onSubmit}
      contentClassName="max-w-lg"
      footerExtra={
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
      }
    >
      <FormField
        control={form.control}
        name="front"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.front')}</FormLabel>
            <FormControl>
              <Textarea
                autoFocus
                className={cn('min-h-20', fieldState.error && 'border-danger')}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="back"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('forms.back')}</FormLabel>
            <FormControl>
              <Textarea
                className={cn('min-h-20', fieldState.error && 'border-danger')}
                {...field}
              />
            </FormControl>
            <FormMessage />
            {preview && back.trim().length > 0 && (
              <div className="mt-1 rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text">
                <MarkdownPreview source={back} />
              </div>
            )}
          </FormItem>
        )}
      />
    </EntityFormDialog>
  )
}
