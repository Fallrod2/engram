import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { dueBarWidth, dueCountTier } from '@/lib/due-count'
import { SUBJECT_BG_CLASS, pigmentSlotForHex } from '@/lib/pigments'

/**
 * Due count as "pressure", not alert (design §6.1). Mono tabular, right
 * aligned; intensity encodes urgency by weight — never color, never red.
 *   0 → `·` text-faint · 1–20 → text-muted · 21–50 → text
 *   >50 → text + a 2px subject-tinted load bar under the number.
 *
 * T-013 — with a non-zero `overdue` the number splits into `arriéré+jour`
 * (e.g. `12+5`): the backlog leads in primary text at semibold, the day's own
 * load follows in the tier tone the whole count would have had anyway. The `+`
 * is literal, not decorative — the two halves add up to the single number this
 * badge used to print, which is exactly the invariant the API guarantees.
 * At `overdue === 0` (the common, healthy case) NOTHING changes: same single
 * number, same tone, no extra mark. Calm stays calm.
 */
export function DueCount({
  value,
  overdue = 0,
  colorHex,
  label,
  className,
}: {
  /** Total due — still `overdue + today`, never one half of it. */
  value: number
  /** Cards whose due date is before today's local midnight (the backlog). */
  overdue?: number
  /** Stored subject hex; tints the >50 load bar. Omit for a neutral total. */
  colorHex?: string | undefined
  /**
   * Accessible name of the count. `null` opts OUT entirely — for callers whose
   * container already carries the full sentence (the sidebar rows, T-017), so
   * the figure is never announced twice or, worse, announced two different ways.
   */
  label?: string | null
  className?: string
}) {
  const tier = dueCountTier(value)
  const backlog = Math.min(Math.max(overdue, 0), Math.max(value, 0))
  const today = Math.max(value, 0) - backlog
  const aria = label === null ? {} : { 'aria-label': label ?? `${value} à réviser` }

  if (tier === 'zero') {
    return (
      <span className={cn('font-mono text-xs tabular-nums text-text-faint', className)} {...aria}>
        ·
      </span>
    )
  }

  const tone = tier === 'low' ? 'text-text-muted' : 'text-text'
  const slot = colorHex ? pigmentSlotForHex(colorHex) : null

  return (
    <span className={cn('inline-flex flex-col items-end gap-0.5', className)} {...aria}>
      <span className={cn('font-mono text-xs tabular-nums', tone)}>
        {backlog > 0 ? (
          <>
            <span className="font-semibold text-text">{backlog}</span>
            {today > 0 && (
              <>
                <span className="font-normal text-text-faint">+</span>
                <span className="font-normal">{today}</span>
              </>
            )}
          </>
        ) : (
          value
        )}
      </span>
      {tier === 'high' && colorHex ? (
        <span className="h-0.5 w-8 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span
            className={cn('block h-full', slot ? SUBJECT_BG_CLASS[slot] : undefined)}
            style={
              slot
                ? { width: `${dueBarWidth(value)}%` }
                : { width: `${dueBarWidth(value)}%`, background: colorHex }
            }
          />
        </span>
      ) : null}
    </span>
  )
}

/** Dot diameter per tier — the graduation "how much" axis. */
const DOT_SIZE: Record<Exclude<ReturnType<typeof dueCountTier>, 'zero'>, string> = {
  low: 'size-1', // 4px  · 1–20
  mid: 'size-1.5', // 6px  · 21–50
  high: 'size-2', // 8px  · >50
}
/** Dot opacity per tier — the same axis, doubled so it survives at 4px. */
const DOT_OPACITY: Record<Exclude<ReturnType<typeof dueCountTier>, 'zero'>, number> = {
  low: 0.7,
  mid: 0.85,
  high: 1,
}

/**
 * T-013 — the collapsed rail's due mark. It replaces the `9+` badge, which was
 * a number nobody could read: 9px digits truncated at a single digit, so `10`
 * and `400` looked the same anyway. A dot says the same thing honestly.
 *
 *   quantity → SIZE (4 / 6 / 8px) + OPACITY, on `dueCountTier` (the same 20/50
 *              thresholds the expanded count and the calendar `DayLoad` already
 *              use, so "a lot" means one thing across the app)
 *   backlog  → the dot climbs from `text-faint` to `text`. Presence, not
 *              magnitude: the exact figures live in the row's accessible name
 *              (T-017), never in this dot.
 *
 * The backlog cue is TONE ONLY — no halo. A ring paints outside the layout box,
 * so a haloed `low` dot measured the same 8px as a bare `high` one and the size
 * axis stopped meaning quantity. Tone is orthogonal to size, so the two signals
 * never trade against each other, and `text` vs `text-faint` is a wide gap in
 * both themes (L .96/.62 dark, .24/.545 light) where `text-muted` would not be.
 *
 * Neutral by construction — no accent (that is the active row's meaning), no
 * danger red (a backlog is not an error).
 */
export function DueDot({
  value,
  overdue = 0,
  className,
}: {
  value: number
  overdue?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  const tier = dueCountTier(value)
  if (tier === 'zero') return null

  const backlog = overdue > 0
  const opacity = DOT_OPACITY[tier]
  return (
    // The caller owns the geometry (see `DOT_GUTTER` in `sidebar.tsx`); this box
    // only centres the dot inside it. Sizing the box rather than translating the
    // dot also keeps `motion`'s inline transform off any Tailwind translate
    // utility, which it would silently overwrite.
    <span className={cn('pointer-events-none flex items-center justify-center', className)}>
      <motion.span
        aria-hidden
        // The tier is exposed on the node: it IS the encoding, and it lets the
        // graduation be asserted without reverse-engineering utility classes.
        data-due-tier={tier}
        data-due-backlog={backlog || undefined}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity }}
        transition={reduce ? { duration: 0 } : { duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'block shrink-0 rounded-full',
          DOT_SIZE[tier],
          backlog ? 'bg-text' : 'bg-text-faint',
        )}
      />
    </span>
  )
}
