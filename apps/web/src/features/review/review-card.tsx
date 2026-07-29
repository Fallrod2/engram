import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import type { ParsedQcm, QcmOption } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { RevealAnimation } from '@/lib/reveal-animation'
import { Markdown } from '@/components/markdown'
import { useTouchSession } from './pointer-labels'
import { contentAlign } from './content-align'
import {
  ANSWER_RISE_KEYFRAMES,
  ANSWER_RISE_TIMES,
  DURATION_BASE,
  EASE_OUT,
  FLIP_DURATION,
  FLIP_EASE,
  FLIP_HALF_MS,
  FLIP_KEYFRAMES,
  FLIP_PERSPECTIVE,
  FLIP_TIMES,
  LIFT_KEYFRAMES,
  LIFT_TIMES,
} from './reveal-motion'

/**
 * The height of the reading surface — decided ONCE, for the whole session, from
 * what this corpus actually puts on a card (T-044).
 *
 * Why a number at all. T-023 made the card FILL its region, which fixed the
 * geometry (nothing moves any more) but handed the card's size to the window:
 * on a 1300px-tall screen the box came out at 1097px with 195px of content in
 * it — 902px of bare surface, 82% of the card empty. That reads far worse than
 * the small floating card it replaced, because emptiness inside a bordered
 * surface is a hole, while the same emptiness outside one is just page.
 *
 * Why 440. Measured in Chromium against the 25 seeded cards
 * (`demo.service.ts`), reading `scrollHeight` of the card's content wrapper
 * (which includes the card's own `py-6`/`py-8` padding), at every width the
 * column takes:
 *
 *   column   plain card, revealed      QCM, asking      QCM, revealed
 *   680px    167 · 195 (21 of 25)      332              435   ← 640px and up
 *   608px    195                       359              463
 *   366px    206 · 233                 398              528
 *   296px    233 · 287                 479              664
 *
 * The distribution is bimodal with nothing in between: 21 plain cards at
 * 167-195px, then the 4 QCM at 378-435px. Any height in (195, 437) behaves
 * identically for the plain cards and only changes whether a QCM scrolls, so
 * the only real choice is "does the tallest card of the corpus fit". It has to:
 * a QCM is read by comparing the four options against the justification, and a
 * box that scrolls the marked options out of view exactly when the verdict
 * lands is the one place where the scroll costs something. 435 + 2px of border
 * = 437, rounded to 440 for a round number with 3px of slack.
 *
 * What that leaves: a typical revealed card fills 195/440 = 44% of the box
 * instead of 18%, and the tallest fills 99%. A taller box would only buy air; a
 * shorter one would only buy back the QCM scroll.
 *
 * One number, not a breakpoint pair. The narrow column needs MORE height
 * (664px for the tallest QCM at 296px wide), but a phone has nowhere to put it:
 * at 320×568 the elastic region only offers 270px in the first place. Sizing
 * for the narrow case would therefore change nothing there and only inflate the
 * desktop box. Narrow screens are served by the clamp below, not by a bigger
 * number.
 *
 * The clamp. `h-[440px]` is a flex item's basis, not a floor: the card keeps
 * the default `flex-shrink: 1`, and `overflow-hidden` makes its automatic
 * minimum size 0, so on a short viewport it gives its height back rather than
 * pushing the rating buttons off screen. The control stack around it is
 * `shrink-0`, so the card is the only thing that yields. Measured, card height
 * then control-stack bottom against the fold: 1512×1300 → 440 / 951 of 1300;
 * 1512×900 → 440 / 751; 1512×800 → 440 / 701; 1512×400 → 197 / 380. Touch is
 * the same story with a taller control stack: 390×664 → 366 / 648,
 * 320×568 → 270 / 552, 844×390 (landscape) → 160 / 370. Nothing ever leaves the
 * viewport and the page itself never scrolls.
 *
 * Exported because the LOADING skeleton mirrors this box exactly — the same
 * lesson as `CONTEXT_INFO_ROW`: a number retyped by hand is a number that
 * drifts, and the skeleton was 25px off the play screen the last time it was.
 */
export const CARD_BOX = 'h-[440px]'

/**
 * The flashcard. How the answer arrives is the user's choice (T-046,
 * `lib/reveal-animation.ts`); the `animation` prop is the ALREADY-RESOLVED value
 * — the session hands over `none` whenever the system asks for reduced motion,
 * so this component never has to arbitrate between a product setting and an
 * accessibility one.
 *
 *   · `unfold` (default) — the historical vertical reveal, with a spine. The
 *     question is anchored at the top of a single scrolling column and NEVER
 *     moves; revealing mounts the answer underneath it, behind a structural rule
 *     that bleeds to the card edges. The card lifts 6px and settles back, and
 *     its resting elevation deepens (`shadow-sm` → `shadow-lg`) to mark the
 *     revealed state. The answer rises 12px with a 2px overshoot. Nothing the
 *     eye is already reading ends up anywhere else, and the answer is not sized
 *     by the question (the old verso overlaid the recto absolutely, which capped
 *     it to the recto's box and forced the question to be echoed a second time).
 *
 *   · `flip` — the card turns over and the answer TAKES THE PLACE of the
 *     question, which is gone. That loses the question/answer comparison, and
 *     that is Alex's call, made knowing the cost — do not quietly restore the
 *     question here. The turn is safe only because the card's height is a
 *     constant (`CARD_BOX`): two faces of different heights would make the whole
 *     screen jump at the hinge.
 *
 *     One exception, and it is not a compromise: on a QCM the marked options ARE
 *     the answer (green on the right one, red on the wrong pick — see
 *     `QcmOptions`). Turning them away would hide the verdict itself, so the
 *     back face of a QCM keeps question + options and adds the justification.
 *     The card still turns; what lands on the far side is the answered card.
 *
 *   · `none` — the answer simply mounts. Same DOM as `unfold`, no transition.
 *
 * Everything animated is `transform`/`opacity`, i.e. composite only. No `height`
 * animation: interpolating `height:auto` costs a reflow per frame for no
 * perceptual gain, since nothing above the answer moves either way. The
 * elevation is a `transition-shadow` utility rather than a motion value, because
 * the shadow tokens are CSS variables (`--shadow-*`) that motion cannot
 * interpolate — and going through the utility means the global
 * `prefers-reduced-motion` rule in `styles.css` neutralises it for free.
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
  animation,
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
  /**
   * The reveal to play — already resolved against `prefers-reduced-motion` by
   * the caller, so `none` here means "do not move", whatever the reason.
   */
  animation: RevealAnimation
  /** Reveal the answer on tap/click (only wired while the answer is hidden). */
  onReveal?: () => void
  /** Answer the QCM by picking an option. */
  onSelect: (index: number) => void
}) {
  const t = useT()
  const touch = useTouchSession()
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
  // T-029 — tapping the card still reveals on a phone, but it stops ADVERTISING
  // itself as a button there: the rating zone already renders an explicit
  // "Révéler la réponse" control with the very same accessible name, and two
  // identically-named buttons for one action is a screen reader walking past
  // the same command twice. Found by the browser harness, which refused the
  // ambiguous locator. On a fine pointer the card is the ONLY reveal affordance
  // (the hint next to it is plain text), so there the role has to stay.
  const named = interactive && !touch
  const flipping = animation === 'flip'

  /**
   * Which face the flip is showing. `front` until the card is edge-on, `back`
   * from the hinge on — so the swap happens at the one instant the card is zero
   * pixels wide and nobody can see the substitution.
   *
   * Driven by a timeout rather than by a motion callback on purpose: the swap is
   * a CONTENT change (React state), and motion's per-frame `onUpdate` would run
   * `setState` on every frame of the turn just to catch one crossing. The
   * timeout and the animation read the same constant (`FLIP_HALF_MS` is defined
   * as half of `FLIP_DURATION`), so they cannot drift.
   *
   * Every other mode keeps this in lockstep with `revealed`, which makes the
   * derivations below uniform: there is no "flip branch" in the render.
   */
  const [face, setFace] = useState<'front' | 'back'>(revealed ? 'back' : 'front')
  useEffect(() => {
    if (!flipping || !revealed) {
      setFace(revealed ? 'back' : 'front')
      return
    }
    setFace('front')
    const id = window.setTimeout(() => setFace('back'), FLIP_HALF_MS)
    return () => window.clearTimeout(id)
  }, [flipping, revealed])

  // The answer is on screen. Same thing as `revealed` everywhere except during
  // the first half of a flip, where the card is still showing its front.
  const turned = !flipping || face === 'back'
  const answerShown = revealed && turned
  // The flip is the only mode that takes the question away, and only on a plain
  // card — a QCM's options carry the verdict and must survive the turn.
  const hideQuestion = flipping && answerShown && qcm === null
  // A QCM whose back says nothing beyond the answer letter has no answer block
  // at all: the options already carry the verdict, and a structural rule that
  // announces an empty section is worse than no rule.
  const showAnswer = answerShown && (qcm === null || qcm.explanation !== '')

  /**
   * What the card itself does, per mode — one object rather than three ternaries
   * on three props, because `exactOptionalPropertyTypes` refuses an explicit
   * `undefined` on `style`/`animate`/`transition`: "absent" and "present and
   * undefined" are not the same thing here, and `none` needs the former.
   *
   * Keyframe arrays come from `reveal-motion.ts` as module constants: a fresh
   * array per render would restart the animation every time the session
   * re-renders (it does, on every interval prefetch).
   */
  const cardMotion =
    animation === 'unfold'
      ? {
          animate: { y: revealed ? LIFT_KEYFRAMES : 0 },
          transition: { duration: DURATION_BASE, times: LIFT_TIMES, ease: EASE_OUT },
        }
      : flipping
        ? {
            // `transformPerspective` goes through motion (folded into the same
            // `transform` string as the rotation) instead of a raw CSS
            // `perspective` on an ancestor: no extra stacking context, and
            // nothing to keep in sync with the animation.
            style: { transformPerspective: FLIP_PERSPECTIVE },
            animate: { rotateY: revealed ? FLIP_KEYFRAMES : 0 },
            transition: { duration: FLIP_DURATION, times: FLIP_TIMES, ease: FLIP_EASE },
          }
        : {}

  // Bring the start of the answer into view ONLY if it begins below the fold.
  // Common case (everything fits): no scroll at all, zero noise.
  useLayoutEffect(() => {
    if (!answerShown) return
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
  }, [answerShown, reduce])

  return (
    <motion.article
      data-revealed={revealed}
      role={named ? 'button' : undefined}
      aria-label={named ? t('session.revealAria') : undefined}
      onClick={interactive ? onReveal : undefined}
      // No `min-h-0` here: what lets this flex item shrink below its intrinsic
      // size is `overflow-hidden` (automatic minimum size is 0 once `overflow`
      // is not `visible`).
      //
      // T-023 replaced a `min-h-[180px]/[220px]` FLOOR with `flex-1`, because a
      // floor can neither shrink to a two-word card nor grow to a long one, so
      // the session's chrome ended up positioned by the content. Filling the
      // region fixed the geometry but sized the card by the window instead.
      //
      // T-044 keeps the geometric win and drops the window: the box is a single
      // measured height (`CARD_BOX`), the same on every card and in every state.
      // Three properties come out of that at once — the question always starts
      // at the same y, the rating bar never moves, and the reading surface stops
      // being 82% empty on a tall screen. A card taller than the box still
      // scrolls INSIDE the scroller below, exactly as before.
      //
      // The third option — a card whose height follows its content — stays
      // rejected, and it was built and measured before either of the other two,
      // because it is the obvious reading of "the box is bigger than what is in
      // it". Rendered, it is worse: honouring the constraint that the rating bar
      // may not move with the content pins the controls anyway, so a two-word
      // card became a 169px slab with 430px of bare page under it. That is the
      // original complaint moved, not answered.
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-lg',
        // A basis, not a floor: `flex-shrink: 1` is left at its default and
        // `overflow-hidden` zeroes the automatic minimum size, so a short
        // viewport takes height back from the card instead of from the controls.
        CARD_BOX,
        'border border-border bg-surface-2',
        interactive && 'cursor-pointer',
        // Elevation, `unfold` only — the one part of that reveal that is a STATE
        // and not a gesture: the lift comes back to zero, the revealed card
        // stays raised. Written as a utility rather than a motion value because
        // `--shadow-*` are CSS variables motion cannot interpolate, and because
        // the global `prefers-reduced-motion` block in `styles.css` then kills
        // the transition without this component knowing anything about it.
        animation === 'unfold' && [
          'transition-shadow duration-base ease-out',
          revealed ? 'shadow-lg' : 'shadow-sm',
        ],
      )}
      {...cardMotion}
    >
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        <div className="px-5 py-6 sm:px-8 sm:py-8">
          {/* Gone on the back face of a flip, and only there. Not hidden with
              CSS: the question must leave the accessibility tree too, or a
              screen reader would still walk a face that is no longer on screen. */}
          {!hideQuestion && (
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
                    // The verdict lands WITH the far face, not before the card
                    // has finished turning: marking the options while the front
                    // is still on screen would answer the question 120ms early.
                    // The options are locked by `revealed` all the same, via
                    // `disabled` below — nothing is clickable mid-turn.
                    revealed={answerShown}
                    locked={revealed}
                    onSelect={onSelect}
                  />
                </>
              ) : (
                <Markdown source={front} variant="card" align={frontAlign} />
              )}
            </div>
          )}
          {showAnswer && (
            <motion.div
              ref={answerRef}
              data-slot="answer"
              // The flip animates the whole card, so the answer riding in on it
              // needs no entrance of its own — and `none` means none.
              initial={animation === 'unfold' ? { opacity: 0 } : false}
              animate={
                animation === 'unfold'
                  ? { opacity: 1, y: ANSWER_RISE_KEYFRAMES }
                  : { opacity: 1, y: 0 }
              }
              transition={{
                duration: DURATION_BASE,
                ease: EASE_OUT,
                y: { duration: DURATION_BASE, times: ANSWER_RISE_TIMES, ease: EASE_OUT },
              }}
            >
              {/* Structural rule bleeding to the edges: read as a division of
                  the card, not as an `<hr>` belonging to the content. It divides
                  the question from the answer — with no question above it (the
                  back face of a flip) it would divide nothing, so it goes. */}
              {!hideQuestion && <hr className="-mx-5 my-6 border-border sm:-mx-8" />}
              <Markdown
                source={qcm ? qcm.explanation : back}
                variant="card"
                align={qcmAlign?.explanation ?? backAlign}
              />
            </motion.div>
          )}
        </div>
      </div>
    </motion.article>
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
  locked,
  onSelect,
}: {
  options: QcmOption[]
  answerIndex: number
  selectedChoice: number | null
  /** The verdict is on screen — paint the marks. */
  revealed: boolean
  /**
   * The card has been answered — accept no further pick. Identical to `revealed`
   * in every mode but the flip, where the marks wait for the far face while the
   * lock takes effect at once (T-046). Two props because they answer two
   * different questions: what the user can DO, and what the user can SEE.
   */
  locked: boolean
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
            disabled={locked}
            aria-keyshortcuts={option.letter}
            onClick={() => onSelect(index)}
            className={cn(
              // T-029 — a QCM is answered by pointing at an option, so the option
              // IS the primary target on a phone. No floor is added here: measured
              // at 390×844, `py-2.5` around one line of `text-card` already gives
              // 49.2px, over the 44px WCAG 2.5.5 target. A `min-h-11` would be an
              // inert class documenting a problem that does not exist.
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
