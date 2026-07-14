import type { ReactNode } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useCoarsePointer } from '@/lib/use-media-query'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Shared create/edit dialog (spec §1.10) hosting an RHF form with a Zod
 * resolver. Serves Subject, Deck and the card-edit variant. `Esc` closes,
 * `⌘/Ctrl+Enter` submits, the fields (passed as children) validate through the
 * `@engram/shared` schemas wired into the caller's `useForm` resolver.
 */
export function EntityFormDialog<TFieldValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  form,
  onSubmit,
  submitLabel,
  contentClassName,
  children,
  footerExtra,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  form: UseFormReturn<TFieldValues>
  onSubmit: (values: TFieldValues) => void
  submitLabel?: string
  contentClassName?: string
  children: ReactNode
  /** Left-aligned footer slot (e.g. the card Markdown toggle). */
  footerExtra?: ReactNode
}) {
  const coarse = useCoarsePointer()
  const t = useT()
  const submit = form.handleSubmit((values) => {
    onSubmit(values)
    onOpenChange(false)
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={submit}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            className="flex flex-col gap-4"
          >
            {children}
            <DialogFooter className={cn(footerExtra && 'sm:justify-between')}>
              {footerExtra}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit">
                  {submitLabel ?? t('common.save')}
                  {!coarse && (
                    <Kbd className="ml-1.5 border-accent-fg/30 bg-transparent text-accent-fg">
                      ⌘↵
                    </Kbd>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
