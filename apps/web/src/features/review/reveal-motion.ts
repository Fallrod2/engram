/**
 * Every number the reveal animations are made of, in one place (T-046).
 *
 * WHY A MODULE. Three of these values are read by two files each (the card and
 * its tests), and the flip needs its half-turn instant to be exactly half of its
 * own duration — a relation that is only true by construction if both come from
 * the same constant. The previous reveal hard-coded `0.16` inline; a second
 * animation with a mid-point would have made that style produce a visible
 * desync the day someone tuned one number and not the other.
 *
 * DURATIONS ARE THE DESIGN TOKENS. `--transition-duration-fast` (120ms) and
 * `--transition-duration-base` (180ms) live in `styles.css`; motion wants
 * seconds, so they are restated here in seconds and NOT invented. That
 * restatement is checked, not trusted: `reveal-motion.test.ts` parses
 * `styles.css` and fails if the two ever drift apart. Same for the easings.
 *
 * BUDGET. CLAUDE.md caps every animation at 250ms. The longest thing here is
 * the flip at 2 × fast = 240ms, which the test also pins.
 */

/** `--transition-duration-fast: 120ms`. */
export const DURATION_FAST = 0.12
/** `--transition-duration-base: 180ms`. */
export const DURATION_BASE = 0.18
/** `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]
/** `--ease-inout: cubic-bezier(0.65, 0, 0.35, 1)`. */
export const EASE_INOUT: [number, number, number, number] = [0.65, 0, 0.35, 1]

/** CLAUDE.md's hard budget — nothing below may exceed it. */
export const MOTION_BUDGET_S = 0.25

// ---------------------------------------------------------------------------
// unfold — "the same reveal, with a spine"
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// flip — the card turns over
// ---------------------------------------------------------------------------

/**
 * A real half-turn, twice, with the content swapped at the hinge.
 *
 * `[0, 90, -90, 0]` on `times: [0, 0.5, 0.5, 1]` is a zero-length jump from +90°
 * to -90° at the midpoint — both are edge-on, i.e. zero pixels wide, so the jump
 * is literally invisible and the rotation reads as one continuous turn. That
 * buys the whole effect with ONE element and no 3D scene: no `preserve-3d`, no
 * `backface-visibility`, no absolutely-positioned second face stacked on the
 * first — which matters here, because an overlaid back face is exactly the
 * structure the vertical reveal was built to get rid of (it sized the answer by
 * the question) and `review-card.test.tsx` forbids it outright.
 */
export const FLIP_KEYFRAMES = [0, 90, -90, 0]
export const FLIP_TIMES = [0, 0.5, 0.5, 1]
/** One ease per segment: turn away, (hinge), turn back. */
export const FLIP_EASE: ['easeIn', 'linear', 'easeOut'] = ['easeIn', 'linear', 'easeOut']

/** 240ms — two `duration-fast` half-turns, 10ms under the budget. */
export const FLIP_DURATION = DURATION_FAST * 2
/** The hinge, in milliseconds: when the faces swap. Exactly half the turn. */
export const FLIP_HALF_MS = Math.round((FLIP_DURATION / 2) * 1000)

/**
 * Depth of the projection, in px, handed to motion as `transformPerspective`
 * rather than written as a raw CSS `perspective` on some ancestor: motion folds
 * it into the same `transform` string as the rotation, so there is no extra
 * stacking context and no CSS 3D property to keep in sync with the animation.
 *
 * 1600, measured rather than guessed. The card is 680 wide, so at the hinge its
 * near edge sits 340px in front of the plane and is magnified by
 * `p / (p - 340)`. At p=900 that is ×1.61: captured in Chromium at 1280×820,
 * the turning card grew from its 440px box to ~670px, spilling over the rating
 * buttons and off the top of the viewport — a big, showy gesture on a screen
 * whose whole design is that nothing moves. At 1600 the factor is ×1.27 (~560px
 * at the widest), the turn still reads as three-dimensional, and the card stays
 * inside the room it was given. Larger still and the rotation flattens into a
 * horizontal squash with no depth to it at all.
 */
export const FLIP_PERSPECTIVE = 1600
