import type { FsrsCardState, FsrsState } from '@engram/shared'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime } from '@/lib/format'

/**
 * FSRS state as a monochrome 8px glyph + luminance (design §6.2). One language,
 * readable without a legend in a dense list:
 *   New(0)        → hollow ring (border-strong)
 *   Learning(1)   → info square, semi-opaque
 *   Review(2)     → success square
 *   Relearning(3) → warning square
 * ("Suspended" from the design isn't in the v1 `State` enum → not rendered.)
 */
const LABELS: Record<FsrsState, string> = {
  0: 'Nouvelle',
  1: 'Apprentissage',
  2: 'Révision',
  3: 'Réapprentissage',
}

function glyphClass(state: FsrsState): string {
  switch (state) {
    case 0:
      return 'border border-border-strong'
    case 1:
      return 'bg-info/60'
    case 2:
      return 'bg-success'
    case 3:
      return 'bg-warning'
  }
}

export function FsrsStateGlyph({ fsrs, className }: { fsrs: FsrsCardState; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-block size-2 shrink-0 rounded-xs',
            glyphClass(fsrs.state),
            className,
          )}
          role="img"
          aria-label={LABELS[fsrs.state]}
        />
      </TooltipTrigger>
      <TooltipContent side="right" className="font-mono text-2xs tabular-nums">
        <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span className="text-text-faint">état</span>
          <span className="text-right text-text">{LABELS[fsrs.state]}</span>
          <span className="text-text-faint">stab.</span>
          <span className="text-right text-text">{fsrs.stability.toFixed(2)}</span>
          <span className="text-text-faint">diff.</span>
          <span className="text-right text-text">{fsrs.difficulty.toFixed(2)}</span>
          <span className="text-text-faint">dû</span>
          <span className="text-right text-text">{formatDateTime(fsrs.due)}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
