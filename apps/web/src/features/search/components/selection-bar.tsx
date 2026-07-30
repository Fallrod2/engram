import { motion } from 'motion/react'
import { FolderInput, Trash2, X } from 'lucide-react'
import { useReducedMotion } from '@/lib/motion'
import { Button } from '@/components/ui/button'
import { usePlural, useT } from '@/lib/i18n'

/**
 * The bulk action bar. Appears only with a selection, docked above the mobile
 * tab bar, and states the count in words — "3 cards selected", never a bare 3.
 *
 * The entrance is an 8px rise over 160 ms (`motion`, house budget < 250 ms) and
 * is skipped entirely when motion is reduced: the bar carries a destructive
 * action, so it must be legible the instant it exists, not on arrival.
 */
export function SelectionBar({
  count,
  onClear,
  onMove,
  onDelete,
  busy,
}: {
  count: number
  onClear: () => void
  onMove: () => void
  onDelete: () => void
  busy: boolean
}) {
  const t = useT()
  const plural = usePlural()
  const reduce = !!useReducedMotion()

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className="sticky bottom-16 z-20 mt-4 md:bottom-4"
      role="region"
      aria-label={t(`search.selection.count_${plural(count)}`, { count })}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-3/95 px-3 py-2 shadow-md backdrop-blur">
        <span className="font-mono text-xs tabular-nums text-text">
          {t(`search.selection.count_${plural(count)}`, { count })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-text-muted"
          onClick={onClear}
          disabled={busy}
        >
          <X />
          {t('search.selection.clear')}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onMove} disabled={busy}>
            <FolderInput />
            {t('search.bulk.move')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger-subtle [&_svg]:text-danger"
            onClick={onDelete}
            disabled={busy}
          >
            <Trash2 />
            {busy ? t('search.bulk.deleting') : t('search.bulk.delete')}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
