import { useEffect } from 'react'
import { Flame } from 'lucide-react'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { usePlural, useT } from '@/lib/i18n'
import { localDayKey } from '@/lib/calendar'

/** Anti-replay key: the last local day the once-a-day breath actually played. */
const SEEN_KEY = 'engram-streak-seen-day'

/**
 * Streak pill (spec §6 detail 3, §5.3bis). Mono count in the sidebar footer —
 * the only always-visible streak surface. The day today's goal is reached
 * (`includesToday` true), it "breathes" ONCE: a 220ms scale of the number plus a
 * dissipating `accent-subtle` flash. Anti-replay via `localStorage` so it never
 * re-fires on a re-render or navigation, and `prefers-reduced-motion` drops the
 * animation entirely (the resting state stays correct).
 */
export function StreakPill({
  current = 0,
  includesToday = false,
  collapsed = false,
}: {
  current?: number
  includesToday?: boolean
  collapsed?: boolean
}) {
  const active = current > 0
  const t = useT()
  const plural = usePlural()
  const reduce = useReducedMotion()
  const numberControls = useAnimationControls()
  const flashControls = useAnimationControls()

  useEffect(() => {
    if (reduce || !includesToday || current <= 0) return
    const today = localDayKey(new Date())
    try {
      if (localStorage.getItem(SEEN_KEY) === today) return
      localStorage.setItem(SEEN_KEY, today)
    } catch {
      return
    }
    // A single 220ms breath: the number scales, an accent-subtle wash dissipates.
    void numberControls.start({
      scale: [1, 1.18, 1],
      transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
    })
    void flashControls.start({
      opacity: [0.7, 0],
      transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
    })
  }, [includesToday, current, reduce, numberControls, flashControls])

  return (
    <span
      className={cn(
        'relative inline-flex items-center gap-1.5 overflow-hidden rounded-full px-2 py-1',
        collapsed && 'px-0',
        active ? 'text-text' : 'text-text-faint',
      )}
      // Collapsed, the pill is a bare flame with no digits at all, so its
      // accessible name is the ONLY place the streak is said out loud. It used to
      // say it in hardcoded French with a hand-rolled `s`, which is wrong twice
      // over: an English user heard French, and `count > 1` gets FR's 0 wrong
      // ("0 jours"). `usePlural` applies the locale's own CLDR rule — FR keeps 0
      // and 1 singular, EN only 1.
      aria-label={t(`sidebar.streak.aria_${plural(current)}`, { count: current })}
      title={t('sidebar.streak.title', { count: current })}
    >
      <motion.span
        aria-hidden
        initial={{ opacity: 0 }}
        animate={flashControls}
        className="pointer-events-none absolute inset-0 rounded-full bg-accent-subtle"
      />
      {/* `size-4`, like every other footer glyph (gear, shield, moon): the pill
          carries the same `px-2` inset as the footer links, so an identically
          sized icon puts the flame on the shared centre line instead of 1px off. */}
      <Flame className={cn('relative size-4', active ? 'text-warning' : 'text-text-faint')} />
      {!collapsed && (
        <motion.span animate={numberControls} className="relative font-mono text-xs tabular-nums">
          {current}
        </motion.span>
      )}
    </span>
  )
}
