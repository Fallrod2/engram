import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { ReviewCounts } from '@/features/generations/review-machine'

/**
 * Sticky bottom bar (spec §4.5): mono counters + the single accent CTA. The
 * "Insérer N cartes" button is disabled when nothing is accepted/edited.
 */
export function ReviewFooterBar({
  counts,
  onInsert,
  insertPending,
}: {
  counts: ReviewCounts
  onInsert: () => void
  insertPending: boolean
}) {
  const n = counts.toInsert
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border bg-surface-1/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      <div className="mx-auto flex max-w-[900px] items-center gap-4">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs tabular-nums text-text-muted">
          <Counter value={counts.accepted} label="acceptées" />
          <Sep />
          <Counter value={counts.edited} label="éditées" />
          <Sep />
          <Counter value={counts.rejected} label="rejetées" />
          <Sep />
          <Counter value={counts.pending} label="restantes" muted={counts.pending === 0} />
        </p>
        <div className="ml-auto flex items-center gap-2">
          {counts.pending > 0 && n > 0 && (
            <span className="hidden text-2xs text-text-faint sm:inline">
              {counts.pending} non triée{counts.pending > 1 ? 's' : ''} ignorée
              {counts.pending > 1 ? 's' : ''}
            </span>
          )}
          <Button onClick={onInsert} disabled={n === 0 || insertPending}>
            {insertPending ? 'Insertion…' : `Insérer ${n} carte${n > 1 ? 's' : ''}`}
            {!insertPending && (
              <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">⌘↵</Kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Counter({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  return (
    <span className={muted ? 'text-text-faint' : undefined}>
      <span className="text-text">{value}</span> {label}
    </span>
  )
}

function Sep() {
  return <span className="text-border-strong">·</span>
}
