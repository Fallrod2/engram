import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/markdown'

/**
 * The flashcard — the only "spectacular" animation of the app (spec §7, design
 * §7). Normal: a 3D `rotateY` flip (220ms, `ease-inout`, `preserve-3d`,
 * `backface-visibility:hidden`). Reduced motion: a ≤120ms recto/verso crossfade,
 * no rotation. The recto sits in normal flow (it sizes the card); the verso
 * overlays it absolutely, so both faces share one box — no layout jump on flip
 * (§7.2). Content is vertically centered but scrolls from the top when it
 * overflows (`m-auto` trick), each face capped at 70vh (§5.4).
 */

const FLIP_EASE = [0.65, 0, 0.35, 1] as const

function Face({
  children,
  centered = false,
  className,
}: {
  children: string
  centered?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex max-h-[80vh] flex-col rounded-lg border border-border bg-surface-2 [backface-visibility:hidden]',
        className,
      )}
    >
      <div className="flex flex-1 flex-col overflow-y-auto px-6 py-7 sm:px-8">
        <div className="m-auto w-full">
          <Markdown source={children} centered={centered} />
        </div>
      </div>
    </div>
  )
}

export function FlipCard({
  front,
  back,
  revealed,
  reduce,
}: {
  front: string
  back: string
  revealed: boolean
  reduce: boolean
}) {
  if (reduce) {
    // Crossfade — recto in flow sizes the box, verso overlays, opacity only.
    return (
      <div data-mode="crossfade" className="relative w-full">
        <motion.div animate={{ opacity: revealed ? 0 : 1 }} transition={{ duration: 0.12 }}>
          <Face centered className="min-h-[240px]">
            {front}
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
          <Face className="min-h-[240px]">{back}</Face>
        </motion.div>
      </div>
    )
  }

  return (
    <div data-mode="flip" className="w-full [perspective:1200px]">
      <motion.div
        className="relative [transform-style:preserve-3d]"
        animate={{ rotateY: revealed ? 180 : 0 }}
        transition={{ duration: 0.22, ease: FLIP_EASE }}
      >
        <Face centered className="min-h-[240px]">
          {front}
        </Face>
        <Face className="absolute inset-0 min-h-[240px] [transform:rotateY(180deg)]">{back}</Face>
      </motion.div>
    </div>
  )
}
