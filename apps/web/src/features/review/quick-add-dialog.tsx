import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import type { Deck, Subject } from '@engram/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDelete } from '@/components/confirm-delete'
import { SubjectDot } from '@/components/subject-dot'
import { MarkdownPreview } from '@/lib/markdown-preview'
import { cn } from '@/lib/utils'
import { usePlural, useT } from '@/lib/i18n'
import { useCoarsePointer } from '@/lib/use-media-query'
import { useCreateCard } from '@/features/cards/queries'
import { allDecksOptions } from '@/features/decks/queries'
import { subjectsListOptions } from '@/features/subjects/queries'

/**
 * Same two required fields as the card editor, same resolver plumbing — the
 * front/back contract of a card is one decision and it is stated once. The deck
 * is deliberately NOT in this schema: it is a `Select`, it always holds a value,
 * and RHF has nothing to validate about it.
 */
const quickAddSchema = z.object({
  front: z.string().trim().min(1, 'forms.fieldRequired'),
  back: z.string().trim().min(1, 'forms.fieldRequired'),
})

type QuickAddValues = z.infer<typeof quickAddSchema>

/** Decks grouped under their subject, archived subjects last (as in the move dialog). */
function groupBySubject(subjects: Subject[], decks: Deck[]) {
  return subjects
    .map((s) => ({ subject: s, decks: decks.filter((d) => d.subjectId === s.id) }))
    .filter((g) => g.decks.length > 0)
    .sort(
      (a, b) =>
        Number(a.subject.archived) - Number(b.subject.archived) ||
        a.subject.position - b.subject.position ||
        a.subject.name.localeCompare(b.subject.name),
    )
}

/**
 * T-032 · write the card you just realised is missing, without leaving the
 * session.
 *
 * The whole point is the moment: the notion is fresh exactly once, and the trip
 * "quit → deck → type → come back" is what kills it. So this dialog is judged on
 * what it does NOT disturb — the card on screen, whether its answer is revealed,
 * the progress counter and the per-card clock all stay exactly as they were
 * (the clock is frozen by the session hook while `quickAdding` is true, on the
 * same mechanism the edit dialog uses).
 *
 * Three decisions worth stating, because each of them had an easier wrong answer:
 *
 *  · THE NEW CARD DOES NOT JOIN THE QUEUE IN PROGRESS. It is born `New` and will
 *    be drawn by a future day's new-card budget like any other. Splicing it into
 *    the current lot would mean reviewing a card ten seconds after writing it —
 *    which measures nothing — and would put a second writer on a queue whose
 *    whole design is "one deterministic lot, frozen at the draw".
 *  · THE DECK IS PRE-CHOSEN, NOT IMPOSED. The card being revised is the best
 *    guess and it is right nearly every time; it is still a guess, so the picker
 *    is right there. Decks under an archived subject are listed and disabled —
 *    the server answers 409 on those (`cards.service.ts`), and hiding them would
 *    leave the user hunting for a deck they know exists.
 *  · "ADD" DOES NOT CLOSE. The real case is three missing notions in a row, so
 *    the fields clear, the deck stays, and focus goes back to the front — the
 *    same loop the deck screen's composer runs. Leaving is `Terminé`, `Échap` or
 *    the ✕, and a draft in progress is never dropped without asking.
 */
export function QuickAddDialog({
  open,
  onOpenChange,
  currentDeckId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Deck of the card on screen — the pre-selection. `null` when there is none. */
  currentDeckId: string | null
}) {
  const t = useT()
  const plural = usePlural()
  const coarse = useCoarsePointer()

  const [deckId, setDeckId] = useState<string | null>(currentDeckId)
  const [added, setAdded] = useState(0)
  const [preview, setPreview] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const form = useForm<QuickAddValues>({
    resolver: zodResolver(quickAddSchema),
    defaultValues: { front: '', back: '' },
  })

  // Each opening is a fresh sheet, seeded on the card that is on screen RIGHT
  // NOW. Nothing survives a close: a draft abandoned yesterday reappearing on
  // top of tomorrow's card is not a feature, it is a surprise.
  useEffect(() => {
    if (!open) return
    form.reset({ front: '', back: '' })
    setDeckId(currentDeckId)
    setAdded(0)
    setPreview(false)
    setConfirmDiscard(false)
    // `currentDeckId` is read here but deliberately kept OUT of the dependency
    // list: the seed is taken at the instant the dialog opens and must not
    // follow the session underneath it — a review acknowledged mid-typing would
    // otherwise move the destination deck under the card being written.
  }, [open, form])

  const subjectsQuery = useQuery({ ...subjectsListOptions(), enabled: open })
  const decksQuery = useQuery({ ...allDecksOptions(), enabled: open })
  const listsPending = subjectsQuery.isPending || decksQuery.isPending
  const listsFailed = subjectsQuery.isError || decksQuery.isError
  const groups = groupBySubject(subjectsQuery.data ?? [], decksQuery.data ?? [])

  // The subject the chosen deck belongs to — needed only so the create can
  // invalidate that subject's deck list. Unknown when the lists failed to load,
  // in which case the broader invalidations (`subjects.all`, `decks.all`) still
  // cover every screen that shows a count.
  const subjectId = (decksQuery.data ?? []).find((d) => d.id === deckId)?.subjectId ?? ''
  const createCard = useCreateCard(deckId ?? '', subjectId)

  const back = form.watch('back')
  const front = form.watch('front')
  const dirty = front.trim().length > 0 || back.trim().length > 0
  // A deck under an archived subject is offered but refused by the server (409).
  // Unreachable through this UI — the picker disables those items and the review
  // queue never serves an archived subject in the first place — so this is a
  // belt, not a state the copy has to explain.
  const chosenArchived = groups.some(
    (g) => g.subject.archived && g.decks.some((d) => d.id === deckId),
  )
  const canSubmit = deckId !== null && !chosenArchived

  const submit = form.handleSubmit((values) => {
    if (!canSubmit || deckId === null) return
    createCard.mutate({ deckId, front: values.front.trim(), back: values.back.trim() })
    // The salvo loop: clear the text, KEEP the deck, hand the caret back to the
    // front. Not awaited — the POST is fire-and-forget with its own error toast
    // and retry action, and making the user wait for a round-trip between two
    // cards is the friction this whole dialog exists to remove.
    form.reset({ front: '', back: '' })
    setAdded((n) => n + 1)
    setPreview(false)
    // RHF's own handle on the registered field, rather than a ref threaded
    // through `FormControl`'s `Slot` and the `Textarea`: one mechanism, and the
    // caret lands where the next card starts.
    form.setFocus('front')
  })

  /**
   * Every way out goes through here — Échap, the ✕, a click outside, `Terminé`.
   * A draft in progress is never dropped silently: the same rule the AI settings
   * card applies to a provider switch with unsaved edits.
   */
  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onOpenChange(false)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else requestClose()
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('session.quickAddDialog.title')}</DialogTitle>
            <DialogDescription>{t('session.quickAddDialog.description')}</DialogDescription>
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="quick-add-deck">{t('session.quickAddDialog.deck')}</Label>
                {listsPending ? (
                  // A skeleton, never a spinner (design system): the row keeps
                  // the height the `Select` will take, so nothing jumps.
                  <Skeleton className="h-9 w-full rounded-sm" />
                ) : (
                  <Select
                    {...(deckId ? { value: deckId } : {})}
                    onValueChange={setDeckId}
                    disabled={listsFailed || groups.length === 0}
                  >
                    <SelectTrigger id="quick-add-deck">
                      <SelectValue placeholder={t('session.quickAddDialog.deckPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map(({ subject, decks }) => (
                        <SelectGroup key={subject.id}>
                          <SelectLabel>
                            <span className="flex items-center gap-1.5">
                              <SubjectDot color={subject.color} muted={subject.archived} />
                              {subject.name}
                              {subject.archived && (
                                <span className="text-text-faint">
                                  {t('session.quickAddDialog.archivedSuffix')}
                                </span>
                              )}
                            </span>
                          </SelectLabel>
                          {decks.map((d) => (
                            <SelectItem key={d.id} value={d.id} disabled={subject.archived}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {/* A failed list is said out loud, and it does not have to be
                    fatal: the deck of the card on screen is already known, so
                    the typing goes on — only the CHOICE is lost. */}
                {listsFailed && (
                  <p className="text-2xs text-danger">
                    {deckId
                      ? t('session.quickAddDialog.deckErrorFallback')
                      : t('session.quickAddDialog.deckError')}
                  </p>
                )}
                {!listsPending && !listsFailed && groups.length === 0 && (
                  <p className="text-2xs text-text-muted">{t('session.quickAddDialog.noDecks')}</p>
                )}
              </div>

              <FormField
                control={form.control}
                name="front"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('forms.front')}</FormLabel>
                    <FormControl>
                      <Textarea
                        autoFocus
                        placeholder={t('composer.frontPlaceholder')}
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
                        placeholder={t('composer.backPlaceholder')}
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

              <DialogFooter className="sm:justify-between">
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
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {added > 0 && (
                    <span
                      className="font-mono text-xs tabular-nums text-text-faint"
                      aria-live="polite"
                    >
                      {t(`composer.added_${plural(added)}`, { count: added })}
                    </span>
                  )}
                  <Button type="button" variant="ghost" onClick={requestClose}>
                    {t('session.quickAddDialog.done')}
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {t('composer.add')}
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

      {/* Stacked on top of the dialog rather than replacing it: cancelling must
          put the user back in front of the text they were about to lose. */}
      <ConfirmDelete
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('session.quickAddDialog.discardTitle')}
        description={t('session.quickAddDialog.discardDesc')}
        confirmLabel={t('session.quickAddDialog.discardConfirm')}
        onConfirm={() => {
          setConfirmDiscard(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}
