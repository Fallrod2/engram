import { useEffect, useState } from 'react'
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
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SubjectDot } from '@/components/subject-dot'
import { usePlural, useT } from '@/lib/i18n'

/**
 * Pick a destination deck for the selected cards.
 *
 * A DECK UNDER AN ARCHIVED SUBJECT IS OFFERED BUT DISABLED. The server refuses
 * that move with a 409 (moving cards out of rotation is a schedule change
 * nobody asked for), and hiding those decks entirely would leave the user
 * hunting for a deck they know exists. Listed, greyed, labelled.
 *
 * The description states what the move does to the review history, because it
 * is not obvious and it is not nothing: the history follows the card, so past
 * reviews are re-attributed to the destination deck.
 */
export function MoveCardsDialog({
  open,
  onOpenChange,
  count,
  subjects,
  decks,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  subjects: Subject[]
  decks: Deck[]
  busy: boolean
  onConfirm: (deckId: string) => void
}) {
  const t = useT()
  const plural = usePlural()
  const [deckId, setDeckId] = useState<string | null>(null)

  useEffect(() => {
    if (open) setDeckId(null)
  }, [open])

  const bySubject = subjects
    .map((s) => ({ subject: s, decks: decks.filter((d) => d.subjectId === s.id) }))
    .filter((g) => g.decks.length > 0)
    .sort(
      (a, b) =>
        Number(a.subject.archived) - Number(b.subject.archived) ||
        a.subject.position - b.subject.position ||
        a.subject.name.localeCompare(b.subject.name),
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`search.moveDialog.title_${plural(count)}`, { count })}</DialogTitle>
          <DialogDescription>{t('search.moveDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="move-destination">{t('search.moveDialog.destination')}</Label>
          {bySubject.length === 0 ? (
            <p className="text-sm text-text-muted">{t('search.moveDialog.noDecks')}</p>
          ) : (
            <Select {...(deckId ? { value: deckId } : {})} onValueChange={setDeckId}>
              <SelectTrigger id="move-destination">
                <SelectValue placeholder={t('search.moveDialog.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {bySubject.map(({ subject, decks: group }) => (
                  <div key={subject.id}>
                    <SelectLabel>
                      <span className="flex items-center gap-1.5">
                        <SubjectDot color={subject.color} muted={subject.archived} />
                        {subject.name}
                        {subject.archived && (
                          <span className="text-text-faint">
                            {t('search.moveDialog.archivedSuffix')}
                          </span>
                        )}
                      </span>
                    </SelectLabel>
                    {group.map((d) => (
                      <SelectItem key={d.id} value={d.id} disabled={subject.archived}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!deckId || busy} onClick={() => deckId && onConfirm(deckId)}>
            {busy ? t('search.bulk.moving') : t('search.moveDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
