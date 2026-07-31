import type { CardSearchHit } from '@engram/shared'
import { ConfirmDelete } from '@/components/confirm-delete'
import { usePlural, useT } from '@/lib/i18n'

/**
 * Confirmation for a bulk delete.
 *
 * NOT "are you sure?". This destroys review history — stability, lapses, the
 * scheduling FSRS built over weeks — and none of it comes back. So the dialog
 * states three things the user cannot see from the toolbar: how many cards,
 * how much accumulated history goes with them, and that it is final. The
 * confirm button repeats the count, because that is the number the click is
 * really about.
 *
 * `hits` are the selected rows we have actually seen (a selection spans pages,
 * and the fetched page does not). Missing ones only make the history line
 * conservative — it never overstates what is lost.
 */
export function BulkDeleteConfirm({
  open,
  onOpenChange,
  count,
  hits,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Size of the SELECTION, which is what gets deleted. */
  count: number
  hits: CardSearchHit[]
  onConfirm: () => void
}) {
  const t = useT()
  const plural = usePlural()

  const reviewed = hits.filter((h) => h.card.fsrs.reps > 0)
  const reps = reviewed.reduce((sum, h) => sum + h.card.fsrs.reps, 0)

  return (
    <ConfirmDelete
      open={open}
      onOpenChange={onOpenChange}
      title={t(`search.bulk.deleteTitle_${plural(count)}`, { count })}
      description={
        <span className="flex flex-col gap-1.5">
          <span>{t(`search.bulk.deleteBody_${plural(count)}`, { count })}</span>
          {reviewed.length > 0 && (
            <span className="text-text">
              {t(`search.bulk.deleteHistory_${plural(reviewed.length)}`, {
                count: reviewed.length,
                reps,
              })}
            </span>
          )}
          <span className="text-text-faint">{t('search.bulk.deleteIrreversible')}</span>
        </span>
      }
      confirmLabel={t(`search.bulk.deleteConfirm_${plural(count)}`, { count })}
      onConfirm={onConfirm}
    />
  )
}
