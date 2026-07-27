import { useLayoutEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Markdown } from '@/components/markdown'
import { contentAlign } from './content-align'

/**
 * The flashcard — a vertical reveal, not a 3D flip. The question is anchored at
 * the top of a single scrolling column and NEVER moves; revealing mounts the
 * answer underneath it, behind a structural rule that bleeds to the card edges.
 * Nothing the eye is already reading shifts, and the answer is no longer sized
 * by the question (the old verso overlaid the recto absolutely, which capped it
 * to the recto's box and forced the question to be echoed a second time).
 *
 * The reveal animates `opacity` + a 6px `translateY` over 160ms — composite
 * only. No `height` animation: interpolating `height:auto` costs a reflow per
 * frame for no perceptual gain, since the question above the fold does not move
 * either way. Under reduced motion the answer simply mounts (`initial={false}`);
 * the DOM is identical in both modes, only the transition differs.
 *
 * Alignment is decided per face by `contentAlign` — a short term centers, a
 * paragraph or any block markup keeps its left reading edge.
 *
 * Reveal is available at the finger (fix-session §1): while hidden, the whole
 * card is a `role="button"` that reveals on tap/click. Keyboard reveal
 * (Space/Enter) is owned by the session's global handler, so the card is
 * deliberately NOT a tab stop — that would add a redundant focus target and let
 * Enter fire the reveal twice.
 */
export function ReviewCard({
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
  /** Reveal the answer on tap/click (only wired while the answer is hidden). */
  onReveal?: () => void
}) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const frontAlign = useMemo(() => contentAlign(front), [front])
  const backAlign = useMemo(() => contentAlign(back), [back])
  const interactive = !revealed && onReveal

  // Bring the start of the answer into view ONLY if it begins below the fold.
  // Common case (everything fits): no scroll at all, zero noise.
  useLayoutEffect(() => {
    if (!revealed) return
    const sc = scrollRef.current
    const an = answerRef.current
    if (!sc || !an) return
    if (an.offsetTop > sc.scrollTop + sc.clientHeight - 48) {
      sc.scrollTo({ top: an.offsetTop - 24, behavior: reduce ? 'auto' : 'smooth' })
    }
    // Hand the keyboard to the scroller: PageDown/arrows scroll the answer.
    sc.focus({ preventScroll: true })
  }, [revealed, reduce])

  return (
    <article
      data-revealed={revealed}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? t('session.revealAria') : undefined}
      onClick={interactive ? onReveal : undefined}
      // No `min-h-0` here: what lets this flex item shrink below its intrinsic
      // size is `overflow-hidden` (automatic minimum size is 0 once `overflow`
      // is not `visible`); the `min-h-*` below is the deliberate floor.
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-lg',
        'min-h-[180px] border border-border bg-surface-2 sm:min-h-[220px]',
        interactive && 'cursor-pointer',
      )}
    >
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          <div data-slot="question">
            <Markdown source={front} variant="card" align={frontAlign} />
          </div>
          {revealed && (
            <motion.div
              ref={answerRef}
              data-slot="answer"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Structural rule bleeding to the edges: read as a division of
                  the card, not as an `<hr>` belonging to the content. */}
              <hr className="-mx-5 my-6 border-border sm:-mx-8" />
              <Markdown source={back} variant="card" align={backAlign} />
            </motion.div>
          )}
        </div>
      </div>
    </article>
  )
}
