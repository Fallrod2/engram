import { useLayoutEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Markdown } from '@/components/markdown'
import { contentAlign } from './content-align'
import type { ParsedQcm, QcmOption } from './qcm'

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
 *
 * A QCM card (`qcm !== null`) is the one exception: its options are themselves
 * buttons, and nesting interactive elements inside a `role="button"` is invalid
 * HTML that both the keyboard and the screen reader lose their way in. So the
 * card drops the role, the label, the click handler and the pointer cursor, and
 * hands the interaction to the options. Space still reveals, through the
 * session's global key router.
 */
export function ReviewCard({
  front,
  back,
  qcm,
  selectedChoice,
  revealed,
  reduce,
  onReveal,
  onSelect,
}: {
  front: string
  back: string
  /** The card read as a multiple-choice question, or null for a plain card. */
  qcm: ParsedQcm | null
  /** Index of the option the user picked, or null (revealed without answering). */
  selectedChoice: number | null
  revealed: boolean
  reduce: boolean
  /** Reveal the answer on tap/click (only wired while the answer is hidden). */
  onReveal?: () => void
  /** Answer the QCM by picking an option. */
  onSelect: (index: number) => void
}) {
  const t = useT()
  const scrollRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const frontAlign = useMemo(() => contentAlign(front), [front])
  const backAlign = useMemo(() => contentAlign(back), [back])
  // Same heuristic, applied to the parsed parts: a short question still centers,
  // and the justification keeps its reading edge as soon as it is a paragraph.
  const qcmAlign = useMemo(
    () =>
      qcm === null
        ? null
        : { question: contentAlign(qcm.question), explanation: contentAlign(qcm.explanation) },
    [qcm],
  )
  const interactive = !revealed && !!onReveal && qcm === null
  // A QCM whose back says nothing beyond the answer letter has no answer block
  // at all: the options already carry the verdict, and a structural rule that
  // announces an empty section is worse than no rule.
  const showAnswer = revealed && (qcm === null || qcm.explanation !== '')

  // Bring the start of the answer into view ONLY if it begins below the fold.
  // Common case (everything fits): no scroll at all, zero noise.
  useLayoutEffect(() => {
    if (!revealed) return
    const sc = scrollRef.current
    if (!sc) return
    // A QCM without justification mounts no answer block — there is nothing to
    // scroll to, but the keyboard handoff below still applies.
    const an = answerRef.current
    if (an && an.offsetTop > sc.scrollTop + sc.clientHeight - 48) {
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
            {qcm ? (
              <>
                <Markdown
                  source={qcm.question}
                  variant="card"
                  align={qcmAlign?.question ?? frontAlign}
                />
                <QcmOptions
                  options={qcm.options}
                  answerIndex={qcm.answerIndex}
                  selectedChoice={selectedChoice}
                  revealed={revealed}
                  onSelect={onSelect}
                />
              </>
            ) : (
              <Markdown source={front} variant="card" align={frontAlign} />
            )}
          </div>
          {showAnswer && (
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
              <Markdown
                source={qcm ? qcm.explanation : back}
                variant="card"
                align={qcmAlign?.explanation ?? backAlign}
              />
            </motion.div>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * The answer choices of a QCM, as a vertical list of buttons — one shot only:
 * every option is `disabled` from the reveal on, so the card can never be
 * answered twice.
 *
 * The group carries `role="group"` and not just an `aria-label`: an `aria-label`
 * on a plain `<div>` is dropped by a good part of the screen readers, and the
 * options would then be announced with no idea what they belong to.
 *
 * After the reveal there are three marked states, not two — "you got it right"
 * is the answer the user clicked for, and it must not look like a bare "here is
 * the answer":
 *   1. the right answer the user actually picked — green, plus a ring;
 *   2. the right answer they did not pick — plain green;
 *   3. their wrong pick — red.
 * Every other option steps back, unmarked.
 *
 * The verdict is readable WITHOUT color: each of the three states carries its
 * own `sr-only` label, the lucide glyphs being decorative (`aria-hidden`) and
 * the ring being a visual reinforcement only. When the card was revealed with
 * Space instead of being answered, `selectedChoice` is null, so state 2 applies
 * and nothing is ever painted red that the user did not choose.
 */
function QcmOptions({
  options,
  answerIndex,
  selectedChoice,
  revealed,
  onSelect,
}: {
  options: QcmOption[]
  answerIndex: number
  selectedChoice: number | null
  revealed: boolean
  onSelect: (index: number) => void
}) {
  const t = useT()
  return (
    <div role="group" aria-label={t('session.qcmOptionsAria')} className="mt-5 flex flex-col gap-2">
      {options.map((option, index) => {
        const correct = revealed && index === answerIndex
        // The right answer the user actually picked: same green, one notch louder.
        const correctPicked = correct && index === selectedChoice
        const wrong = revealed && index === selectedChoice && index !== answerIndex
        return (
          <button
            key={option.letter}
            type="button"
            disabled={revealed}
            aria-keyshortcuts={option.letter}
            onClick={() => onSelect(index)}
            className={cn(
              'flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left',
              'transition-colors duration-fast ease-out disabled:pointer-events-none',
              !revealed && 'cursor-pointer border-border bg-surface-3 hover:border-border-strong',
              // Revealed and neither right nor picked: still legible, but it
              // steps back so the two marked options carry the reading.
              revealed && 'border-border text-text-muted',
              correct && 'border-success bg-success-subtle text-text',
              correctPicked && 'ring-1 ring-success',
              wrong && 'border-danger bg-danger-subtle text-text',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs',
                'font-mono text-card-sm',
                !correct && !wrong && 'bg-surface-2 text-text-muted',
                correct && 'bg-success text-success-fg',
                wrong && 'bg-danger text-danger-fg',
              )}
            >
              {option.letter}
            </span>
            <Markdown
              source={option.text}
              variant="card"
              align="start"
              className="min-w-0 flex-1"
            />
            {correct && <Check aria-hidden className="mt-1.5 size-4 shrink-0 text-success" />}
            {wrong && <X aria-hidden className="mt-1.5 size-4 shrink-0 text-danger" />}
            {(correct || wrong) && (
              <span className="sr-only">
                {correctPicked
                  ? t('session.qcmCorrectPicked')
                  : correct
                    ? t('session.qcmCorrect')
                    : t('session.qcmWrong')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
