import { Check, Slash } from 'lucide-react'
import type { Generation } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT, usePlural } from '@/lib/i18n'

/**
 * Run-status pill for a generation (spec §1.10, §5). Encoded **monochrome +
 * luminance** — never the four rating hues:
 *   pending   → a softly breathing dot + "en cours"
 *   succeeded → neutral check + "N cartes"
 *   failed    → struck glyph in `text-faint` + "échec"
 */
export function GenerationStatusBadge({
  generation,
  className,
}: {
  generation: Pick<Generation, 'status' | 'items'>
  className?: string
}) {
  const { status, items } = generation
  const t = useT()
  const plural = usePlural()

  if (status === 'pending') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-text-muted', className)}>
        <span
          className="size-1.5 animate-pulse rounded-full bg-text-muted motion-reduce:animate-none"
          aria-hidden
        />
        {t('generation.statusPending')}
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-text-faint', className)}>
        <Slash className="size-3.5" strokeWidth={2} aria-hidden />
        {t('generation.statusFailed')}
      </span>
    )
  }

  const inserted = items.filter((i) => i.status === 'accepted' || i.status === 'edited').length
  const count = inserted > 0 ? inserted : items.length
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-text-muted', className)}>
      <Check className="size-3.5 text-text" strokeWidth={2.25} aria-hidden />
      <span className="font-mono tabular-nums">{count}</span>{' '}
      {t(`generation.badgeCard_${plural(count)}`)}
    </span>
  )
}
