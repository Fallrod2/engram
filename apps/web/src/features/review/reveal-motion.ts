/**
 * Every number the card reveal is made of, in one place.
 *
 * WHY A MODULE. Each of these values is read by two files (the card and its
 * tests), and the previous reveal hard-coded `0.16` inline — a number nothing
 * could check and nothing could reuse.
 *
 * DURATIONS ARE THE DESIGN TOKENS. `--transition-duration-base` (180ms) lives in
 * `styles.css`; motion wants seconds, so it is restated here in seconds and NOT
 * invented. That restatement is checked, not trusted: `reveal-motion.test.ts`
 * parses `styles.css` and fails if the two ever drift apart. Same for the easing.
 *
 * BUDGET. CLAUDE.md caps every animation at 250ms; the reveal runs at 180.
 *
 * WHAT USED TO BE HERE. A 3D flip (`FLIP_*`, 240ms, perspective 1600) and the
 * `EASE_INOUT` token it was built around, plus a `none` mode — the three-valued
 * reveal setting delivered that same morning. Tried in real use, refused by Alex
 * the afternoon of 29/07/2026: the
 * app has ONE reveal, the unfold, and reduced motion is what turns it off. The
 * flip is gone from the code rather than left behind a dead branch; the story is
 * in git, where an unreachable code path cannot be mistaken for a feature.
 */

/** `--transition-duration-base: 180ms`. */
export const DURATION_BASE = 0.18
/** `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** CLAUDE.md's hard budget — nothing below may exceed it. */
export const MOTION_BUDGET_S = 0.25

/**
 * The card's lift, as keyframes that RETURN TO ZERO.
 *
 * A permanent lift would be the obvious way to sell the elevation change, and it
 * is refused: the session's whole geometry rests on the question, the context
 * strip and the rating bar sitting at a constant y (T-023/T-044,
 * `session-layout.test.tsx`). A card that stays 6px higher once revealed moves
 * the question for good — the exact regression that work removed. Lifting and
 * settling costs nothing on that front: the end state is byte-for-byte the start
 * state, and only the 180ms in between show the gesture.
 *
 * Module constant, not an inline literal, so its identity is stable across
 * renders: motion restarts a keyframe animation when its target changes, and a
 * fresh array on every render (the session re-renders on each preview fetch)
 * would replay the lift at random.
 */
export const LIFT_KEYFRAMES = [0, -6, 0]
/** Peak at 40% of the run: a quick rise, a longer settle. */
export const LIFT_TIMES = [0, 0.4, 1]

/**
 * The answer's rise, with a short overshoot — the "rebond court". 12px up, 2px
 * past the mark, then back. Composite-only (`transform`/`opacity`); no `height`
 * interpolation, which would cost a reflow per frame for no perceptual gain
 * since nothing above the answer moves either way.
 */
export const ANSWER_RISE_KEYFRAMES = [12, -2, 0]
export const ANSWER_RISE_TIMES = [0, 0.72, 1]
