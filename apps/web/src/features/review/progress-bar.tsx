import { motion } from 'motion/react'

/**
 * Session progress — a 2px accent fill on the top edge (spec §4.2), advancing
 * one notch per card in 120ms (§7.3). Reduced motion → instant (the global CSS
 * cut zeroes the transition; motion also respects it via `reduce`).
 */
export function ProgressBar({
  done,
  total,
  reduce,
}: {
  done: number
  total: number
  reduce: boolean
}) {
  const pct = total === 0 ? 0 : Math.min(100, (done / total) * 100)
  return (
    <div
      className="h-0.5 w-full bg-surface-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="Progression de la session"
    >
      <motion.div
        className="h-full bg-accent"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}
