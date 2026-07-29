// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { REVEAL_ANIMATIONS, type RevealAnimation } from '@/lib/reveal-animation'
import { CARD_BOX, ReviewCard } from './review-card'
import { RatingBar } from './rating-bar'

/**
 * T-023 — the session screen's geometry must not depend on what is on the card.
 *
 * Measured in Chromium at 1512×797 before the fix, the two things the flip-less
 * vertical reveal exists to guarantee were both false:
 *
 *   · revealing a two-word card slid the QUESTION 22.7px up (292.7 → 270),
 *     because the whole column was vertically centred and the rating zone grew
 *     45.4px when the reveal hint became four buttons — centring split the
 *     difference;
 *   · the rating bar sat at y=501 on a short card and y=688 on a long one —
 *     187px apart, on a screen where `1`-`4` are meant to be pressed without
 *     looking.
 *
 * jsdom runs no layout engine, so this file cannot measure pixels. What it CAN
 * do is pin the three structural facts the browser geometry is derived from, so
 * that the fix cannot be undone by accident:
 *
 *   1. the card's height is DECLARED, identical on every card and in every
 *      state, and stands on no floor and no growth of its own;
 *   2. the rating zone occupies the SAME box before and after the reveal, so
 *      the context strip above it cannot move when the answer appears;
 *   3. that box is the same on a keyboard and on a touch device, so the two
 *      pointer types get the same anchored screen.
 *
 * The pixel-level proof stays a browser measurement (see the before/after
 * geometry captured for T-023 and T-044); these are the invariants that make it
 * hold.
 *
 * T-044 amendment — what point 1 means changed, and the tests below changed with
 * it, deliberately and without loosening anything.
 *
 * T-023 wrote point 1 as "the card takes its height from its REGION (`flex-1`)".
 * That was the fix for a `min-h` floor, and it did hold the geometry — but it
 * also handed the card's size to the window: measured at 1512×1300, the box came
 * out 1097px tall around 195px of content, 82% empty. What the screen looks like
 * matters as much as whether it moves, and a 900px hole inside a bordered
 * surface reads worse than the small floating card the floor produced.
 *
 * So the card now takes its height from a single measured constant, `CARD_BOX`
 * (440px — see its docstring for the corpus measurement behind the number), and
 * the block around it is vertically centred instead of bottom-anchored, which is
 * only safe BECAUSE nothing in the column varies any more.
 *
 * What these tests must keep forbidding is unchanged, and it is the thing that
 * both regressions had in common:
 *
 *   · a card height that depends on its CONTENT — hence "the same declared box
 *     for a two-word card and a multi-block one, in both states", now checked
 *     against one constant instead of an empty set of `min-h` classes;
 *   · a rating zone that changes size between states — untouched below.
 *
 * `flex-1` is no longer asserted (it is what made the window the author of the
 * height) and a floor is still refused, now for both `min-h-` and `max-h-`: a
 * `min-h` would put the content back in charge of a taller card, and a `max-h`
 * would silently contradict `CARD_BOX`.
 *
 * T-029 amendment. The touch adaptation ADDS a constant row to the control
 * stack (`SessionContextBar`'s 44px action row) and REMOVES a constant one (the
 * keyboard cheat-sheet). Neither weakens what this file pins, and the contract
 * asserted here is deliberately unchanged: the rating zone still reserves ONE
 * box, the same on both pointer types, at both breakpoints — the touch reveal
 * button is laid out inside it exactly as the `Espace` hint was. What T-029
 * changes lives one level up and is pinned in `touch-affordances.test.tsx`
 * ("the instrumentation strip keeps its 24px on BOTH pointer types"), plus the
 * Chromium measurement in the T-029 report: at 390×844, 320×568 and 834×1112
 * the card, the question and the control stack sit at the same y in ASKING, in
 * REVEALED and on the next card, and the LOADING skeleton mirrors the play
 * stack to the pixel (both read the same two exported constants).
 *
 * T-046 amendment — this file gained a THIRD axis, and lost nothing.
 *
 * The reveal is now a user setting with three values (`lib/reveal-animation.ts`),
 * one of which turns the card over. A flip is the one reveal that CANNOT survive
 * a card whose height depends on its content: two faces of different heights and
 * the whole screen jumps at the hinge. So the invariant this file pins is now
 * load-bearing for a second reason, and the cases below are parameterised over
 * the three modes instead of being written once against the default — "the same
 * declared box for a two-word card and a multi-block one" now has to hold in
 * `unfold`, in `flip` and in `none`, in both states.
 *
 * Nothing was loosened to make room for it: no assertion was deleted or
 * weakened, the equality against `[CARD_BOX]` is still exact, and the `min-h-`/
 * `max-h-`/`flex-1` refusals still apply. The only change is that each of them
 * runs three times.
 *
 * What deliberately does NOT belong here: the flip's rotation, the unfold's lift
 * and its deepened shadow. All three are `transform`/`box-shadow` — they paint
 * differently, they lay out identically, and jsdom would only be able to read
 * back the inline styles motion happens to have written on the frame the
 * assertion ran. Their proof is the Chromium capture (three modes × two themes,
 * mid-animation frames included) plus the fact that the unfold's lift is
 * declared as keyframes RETURNING TO ZERO (`LIFT_KEYFRAMES` in
 * `reveal-motion.ts`), so its end state is its start state.
 */

// jsdom defines no `Element.scrollTo`; `ReviewCard` calls it on reveal.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  })
})

afterEach(cleanup)

const PLAIN = { qcm: null, selectedChoice: null, onSelect: () => {} } as const

/** Every `h-*` / `min-h-*` / `max-h-*` utility on a node, responsive variants included. */
function heightClasses(el: Element): string[] {
  return el.className
    .split(/\s+/)
    .filter((c) => /(^|:)(min-h-|max-h-|h-)/.test(c))
    .sort()
}

function renderCard(props: {
  front: string
  back: string
  revealed: boolean
  animation?: RevealAnimation
}) {
  const { animation = 'unfold', ...rest } = props
  const { container } = render(
    <ReviewCard {...PLAIN} {...rest} reduce animation={animation} onReveal={() => {}} />,
  )
  return container.querySelector('article')!
}

describe('T-023/T-044 — the card is sized by one constant, never by its content', () => {
  const SHORT = { front: 'a flaw', back: 'un défaut' }
  const LONG = {
    front: 'Invariant de boucle ?',
    back: ['## Définition', '', 'Un paragraphe.', '', '- un', '- deux', '- trois'].join('\n'),
  }

  it('is exactly one unconditional height — no floor, no ceiling, no breakpoint', () => {
    // The constant is asserted in its own right because three separate things
    // read it: the card, the LOADING skeleton, and this file. A responsive
    // variant here would mean two boxes to keep in step instead of one, and a
    // `min-h-`/`max-h-` next to it would put the content (or the window) back in
    // charge of the height that `CARD_BOX` exists to own.
    expect(CARD_BOX).toMatch(/^h-\[\d+px\]$/)
  })

  // T-046: every case below runs once per reveal mode. The box is what makes a
  // flip safe, so it has to be proven under the flip too — not only under the
  // default the assertions were originally written against.
  describe.each(REVEAL_ANIMATIONS)('reveal = %s', (animation) => {
    it('carries that box and nothing else that could resize it', () => {
      const card = renderCard({ ...SHORT, revealed: false, animation })
      expect(heightClasses(card)).toEqual([CARD_BOX])
      // `min-h-[180px] sm:min-h-[220px]` was the original floor: a two-word card
      // could not shrink under it and a long one could not grow past its region,
      // so the chrome ended up positioned by content. `flex-1` replaced it and
      // handed the height to the WINDOW instead (1097px of box at 1512×1300).
      // Both are refused by the equality above; this states the second explicitly,
      // because it is the one that reads as an improvement.
      expect(card.className.split(/\s+/)).not.toContain('flex-1')
    })

    it('declares the same box for a two-word card and a multi-block one', () => {
      const short = heightClasses(renderCard({ ...SHORT, revealed: true, animation }))
      cleanup()
      const long = heightClasses(renderCard({ ...LONG, revealed: true, animation }))
      expect(long).toEqual(short)
    })

    it('declares the same box before and after the reveal', () => {
      const asking = heightClasses(renderCard({ ...SHORT, revealed: false, animation }))
      cleanup()
      const revealed = heightClasses(renderCard({ ...SHORT, revealed: true, animation }))
      expect(revealed).toEqual(asking)
    })
  })

  it('declares the same box whichever reveal the user picked', () => {
    // The cross-mode statement the per-mode cases cannot make: three settings,
    // one geometry. A mode that bought its effect with a different box (a taller
    // card to fit an un-anchored flip, say) would pass every case above and fail
    // this one.
    const boxes = REVEAL_ANIMATIONS.map((animation) => {
      const classes = heightClasses(renderCard({ ...LONG, revealed: true, animation }))
      cleanup()
      return classes
    })
    for (const box of boxes) expect(box).toEqual([CARD_BOX])
  })

  it('keeps the overflow inside the card rather than on the page', () => {
    const card = renderCard({ ...LONG, revealed: true })
    // `overflow-hidden` on the card carries two jobs, and T-044 leans on the
    // second: it keeps a long verso scrolling INSIDE the card, and it zeroes the
    // card's automatic minimum size, which is what lets `CARD_BOX` behave as a
    // flex BASIS rather than a floor — on a viewport too short for 440px the
    // card gives height back instead of pushing the rating buttons off screen.
    // Measured at 1512×400: card 197px, rating grid ending 45px above the fold.
    expect(card.className.split(/\s+/)).toContain('overflow-hidden')
    const scroller = card.firstElementChild!
    const classes = scroller.className.split(/\s+/)
    expect(classes).toContain('overflow-y-auto')
    expect(classes).toContain('min-h-0')
    expect(classes).toContain('flex-1')
  })
})

describe('T-023 — the rating zone reserves one constant box', () => {
  const BAR = {
    preview: undefined,
    disabled: false,
    flashGrade: null,
    reduce: true,
    onReveal: () => {},
    onRate: () => {},
  } as const

  /** Outermost node the bar renders — the box the context strip sits on top of. */
  function barRoot(): Element {
    return document.body.firstElementChild!.firstElementChild!
  }

  function renderBar(revealed: boolean, suggestedGrade: 1 | null = null) {
    render(<RatingBar {...BAR} revealed={revealed} suggestedGrade={suggestedGrade} />)
    return barRoot()
  }

  it('reserves the rated row height while the answer is still hidden', () => {
    // The reveal hint used to be a bare 18.6px line of text; the four buttons
    // that replace it are 64px, so every reveal shoved the context strip
    // (Éditer / Passer / Annuler + the remaining-by-state counters) up by 45px.
    expect(heightClasses(renderBar(false))).toContain('sm:h-16')
  })

  it('reserves the WRAPPED grid height on a narrow screen, not just the wide one', () => {
    // The grid is `grid-cols-2 sm:grid-cols-4`: under 640px the four buttons are
    // two 64px rows plus the 8px gap. Reserving a flat `h-16` fixed the desktop
    // and left a 390px viewport still sliding the context strip 72px per reveal.
    expect(heightClasses(renderBar(false))).toContain('h-[136px]')
  })

  it('gives the QCM "Suivant" branch that same box, at both breakpoints', () => {
    // Documented already at the call site; asserted here so the branches are
    // checked against ONE reservation instead of three independent numbers.
    const asking = heightClasses(renderBar(false))
    cleanup()
    renderBar(true, 1)
    expect(screen.getByRole('button', { name: /^Suivant/ })).toBeTruthy()
    expect(heightClasses(barRoot())).toEqual(asking)
  })

  it('gives the two verdicts that same box, at both breakpoints (T-047)', () => {
    // Two buttons instead of four change what is INSIDE the reservation, never
    // its size: the question stays at its y, the bar stays at its position, and
    // the phone layout does not move because the plain card changed its
    // question. The pixel proof is the Chromium measurement in the T-047 report
    // (390×844 and 1280×800, ASKING → REVEALED → next card, plain and QCM); this
    // is the structural fact it rests on.
    const asking = heightClasses(renderBar(false))
    cleanup()
    renderBar(true)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(heightClasses(barRoot())).toEqual(asking)
  })

  it('reserves the same box for a touch pointer as for a keyboard', () => {
    // The touch branch swaps the hint for a ≥48px tap target; the RESERVATION
    // around it must not change, or the anchored geometry would hold on a
    // laptop and drift on a phone.
    const keyboard = heightClasses(renderBar(false))
    cleanup()
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('pointer: coarse'),
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )
    try {
      const touch = heightClasses(renderBar(false))
      expect(screen.getByRole('button', { name: 'Révéler la réponse' })).toBeTruthy()
      expect(touch).toEqual(keyboard)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
