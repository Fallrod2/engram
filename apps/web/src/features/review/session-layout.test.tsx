// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReviewCard } from './review-card'
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
 *   1. the card takes its height from its region (`flex-1`) and stands on NO
 *      minimum of its own — a floor is what made a short card a half-empty box
 *      and, worse, what let the content decide where the chrome sat;
 *   2. the rating zone occupies the SAME box before and after the reveal, so
 *      the context strip above it cannot move when the answer appears;
 *   3. that box is the same on a keyboard and on a touch device, so the two
 *      pointer types get the same anchored screen.
 *
 * The pixel-level proof stays a browser measurement (see the before/after
 * geometry captured for T-023); these are the invariants that make it hold.
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

function renderCard(props: { front: string; back: string; revealed: boolean }) {
  const { container } = render(<ReviewCard {...PLAIN} {...props} reduce onReveal={() => {}} />)
  return container.querySelector('article')!
}

describe('T-023 — the card is sized by its region, never by its content', () => {
  const SHORT = { front: 'a flaw', back: 'un défaut' }
  const LONG = {
    front: 'Invariant de boucle ?',
    back: ['## Définition', '', 'Un paragraphe.', '', '- un', '- deux', '- trois'].join('\n'),
  }

  it('carries no height floor of its own — it grows into the region instead', () => {
    const card = renderCard({ ...SHORT, revealed: false })
    // `min-h-[180px] sm:min-h-[220px]` was the floor: a two-word card could not
    // shrink under it (≈190px of empty box at 1512×797) and a long one could not
    // grow past the region either, so the chrome ended up positioned by content.
    expect(heightClasses(card).filter((c) => c.includes('min-h-'))).toEqual([])
    expect(card.className.split(/\s+/)).toContain('flex-1')
  })

  it('declares the same box for a two-word card and a multi-block one', () => {
    const short = heightClasses(renderCard({ ...SHORT, revealed: true }))
    cleanup()
    const long = heightClasses(renderCard({ ...LONG, revealed: true }))
    expect(long).toEqual(short)
  })

  it('declares the same box before and after the reveal', () => {
    const asking = heightClasses(renderCard({ ...SHORT, revealed: false }))
    cleanup()
    const revealed = heightClasses(renderCard({ ...SHORT, revealed: true }))
    expect(revealed).toEqual(asking)
  })

  it('keeps the overflow inside the card rather than on the page', () => {
    const card = renderCard({ ...LONG, revealed: true })
    // `overflow-hidden` on the card is also what allows it to shrink below its
    // intrinsic size (automatic minimum size is 0 once overflow is not visible).
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
