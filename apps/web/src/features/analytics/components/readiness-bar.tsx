import { motion } from 'motion/react'
import { useReducedMotion } from '@/lib/motion'
import type { ReadinessBreakdown } from '@engram/shared'
import { cn } from '@/lib/utils'
import { subjectColorValue } from '@/lib/pigments'
import { readinessSegments, type ReadinessSegmentKind } from '../readiness'

/**
 * The composition of a readiness figure, as a part-to-whole bar (dataviz §7.2):
 * ready · to review · never seen, in that frozen order, separated by a 2px
 * surface gap.
 *
 * ═══ WHY THESE THREE FILLS ═══
 *
 * The four rating hues (danger/warning/success/info) are RESERVED for FSRS
 * ratings and mean nothing here, so this bar uses ONE hue — the subject's own
 * pigment — as a sequential ramp, plus a texture:
 *
 *   · ready         → the pigment, solid. The mass you can count on.
 *   · to review     → the same pigment, faded. Same hue, less of it: learned,
 *                     and predicted to have decayed below the threshold.
 *   · never seen    → a hatch in faint ink. NOT a third hue, and not the same
 *                     mark as "to review": these cards were never graded, FSRS
 *                     holds no memory state for them, and the difference between
 *                     "forgotten" and "never opened" is the whole point of the
 *                     panel. Texture also survives a colorblind reader, a
 *                     grayscale print and forced-colors mode.
 *
 * The bar carries NO text and is `aria-hidden`: every count it encodes is spelt
 * out in the legend next to it, which is the accessible channel (spec §1.4).
 */

const HATCH =
  'repeating-linear-gradient(135deg, var(--color-text-faint) 0 2px, transparent 2px 5px)'

/** Minimum visible width of a non-empty segment, so "1 of 400" never vanishes. */
const MIN_SEGMENT = '3px'

export function ReadinessBar({
  breakdown,
  colorHex,
  className,
}: {
  breakdown: ReadinessBreakdown
  /** The subject's stored hex — resolved to its themeable pigment token. */
  colorHex: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const segments = readinessSegments(breakdown)
  const color = subjectColorValue(colorHex)

  // No card at all: an empty track, never a full bar. The message lives above.
  if (breakdown.cardTotal === 0) {
    return (
      <span className={cn('block h-2.5 w-full rounded-full bg-surface-3', className)} aria-hidden />
    )
  }

  return (
    <span
      className={cn(
        'flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3',
        className,
      )}
      aria-hidden
    >
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <motion.span
            key={s.kind}
            className="block h-full first:rounded-l-full last:rounded-r-full"
            style={{ minWidth: MIN_SEGMENT, ...segmentFill(s.kind, color) }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${s.share * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.16, ease: 'easeOut' }}
          />
        ))}
    </span>
  )
}

/**
 * Return type deliberately INFERRED (a union of three concrete shapes) rather
 * than `CSSProperties`: under `exactOptionalPropertyTypes`, widening it makes
 * every optional style key `| undefined`, which `MotionStyle` refuses.
 */
function segmentFill(kind: ReadinessSegmentKind, color: string) {
  switch (kind) {
    case 'ready':
      return { background: color }
    case 'toReview':
      return { background: color, opacity: 0.32 }
    case 'neverReviewed':
      return { backgroundImage: HATCH }
  }
}

/** The swatch that ties a legend entry to its segment — same fill, same order. */
export function ReadinessSwatch({
  kind,
  colorHex,
}: {
  kind: ReadinessSegmentKind
  colorHex: string
}) {
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-xs',
        kind === 'neverReviewed' && 'bg-surface-3 ring-1 ring-inset ring-border',
      )}
      style={segmentFill(kind, subjectColorValue(colorHex))}
      aria-hidden
    />
  )
}
