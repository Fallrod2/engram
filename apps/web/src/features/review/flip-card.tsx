import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Markdown } from '@/components/markdown'

/**
 * The flashcard — the only "spectacular" animation of the app (spec §7, design
 * §7). Normal: a 3D `rotateY` flip (220ms, `ease-inout`, `preserve-3d`,
 * `backface-visibility:hidden`). Reduced motion: a ≤120ms recto/verso crossfade,
 * no rotation. The recto sits in normal flow (it sizes the card); the verso
 * overlays it absolutely, so both faces share one box — no layout jump on flip
 * (§7.2). Content is vertically centered but scrolls from the top when it
 * overflows (`m-auto` trick), each face capped at 70vh (§5.4).
 *
 * Reveal is available at the finger (fix-session §1): while ASKING, the whole
 * card is a `role="button"` that reveals on tap/click. The verso keeps the
 * question visible (fix-session §2): the recto is echoed in a small, dimmed,
 * centered header above a separator, then the answer — Anki/Mochi style — so the
 * rating is never made blind. Both faces are centered so the flip has no
 * horizontal jump.
 */

const FLIP_EASE = [0.65, 0, 0.35, 1] as const

function Face({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex max-h-[80vh] flex-col rounded-lg border border-border bg-surface-2 [backface-visibility:hidden]',
        className,
      )}
    >
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-7 sm:px-8">
        <div className="m-auto w-full">{children}</div>
      </div>
    </div>
  )
}

/** Verso content: the recalled question (small, dimmed) above a separator, then
 * the answer — so the user always sees what they are rating (fix-session §2). */
function Verso({ front, back }: { front: string; back: string }) {
  const t = useT()
  return (
    <div className="flex w-full flex-col gap-4">
      <div aria-label={t('session.questionRecall')}>
        <Markdown source={front} centered className="text-sm text-text-muted" />
      </div>
      <hr className="border-border" />
      <Markdown source={back} centered />
    </div>
  )
}

export function FlipCard({
  front,
  back,
  revealed,
  reduce,
  onReveal,
}: {
  front: string
  back: string
  revealed: boolean
  reduce: boolean
  /** Reveal the answer on tap/click (only wired while the card is face-down). */
  onReveal?: () => void
}) {
  const t = useT()

  // Tap/click affordance, active only while the answer is hidden. Keyboard
  // reveal (Space/Enter) is owned by the session's global handler, so the card
  // is deliberately NOT a tab stop — that would add a redundant focus target and
  // let Enter fire the reveal twice. Touch/mouse users get the onClick path.
  const interactive = !revealed && onReveal
  const role = interactive ? ('button' as const) : undefined
  const revealLabel = interactive ? t('session.revealAria') : undefined
  const handleReveal = interactive ? onReveal : undefined

  if (reduce) {
    // Crossfade — recto in flow sizes the box, verso overlays, opacity only.
    return (
      <div
        data-mode="crossfade"
        className={cn('relative w-full', interactive && 'cursor-pointer')}
        role={role}
        aria-label={revealLabel}
        onClick={handleReveal}
      >
        <motion.div animate={{ opacity: revealed ? 0 : 1 }} transition={{ duration: 0.12 }}>
          <Face className="min-h-[240px]">
            <Markdown source={front} centered />
          </Face>
        </motion.div>
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={{ opacity: revealed ? 1 : 0 }}
          transition={{ duration: 0.12 }}
          style={{ pointerEvents: revealed ? 'auto' : 'none' }}
          aria-hidden={!revealed}
        >
          <Face className="min-h-[240px]">
            <Verso front={front} back={back} />
          </Face>
        </motion.div>
      </div>
    )
  }

  return (
    <div
      data-mode="flip"
      className={cn('w-full [perspective:1200px]', interactive && 'cursor-pointer')}
      role={role}
      aria-label={revealLabel}
      onClick={handleReveal}
    >
      <motion.div
        className="relative [transform-style:preserve-3d]"
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ duration: 0.22, ease: FLIP_EASE }}
      >
        <Face className="min-h-[240px]">
          <Markdown source={front} centered />
        </Face>
        <Face className="absolute inset-0 min-h-[240px] [transform:rotateY(180deg)]">
          <Verso front={front} back={back} />
        </Face>
      </motion.div>
    </div>
  )
}
