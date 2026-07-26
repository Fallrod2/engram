// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReviewCard } from './review-card'

// jsdom implements no layout engine and does not define `Element.scrollTo`.
// Every offset/client metric reads 0, so the "answer starts below the fold"
// guard is always true here and the call would throw. Stubbing it keeps the
// component under test unchanged; the scroll itself is browser behaviour and is
// out of scope for a DOM unit test.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  })
})

afterEach(cleanup)

/** The answer node, or `null` while the card is still hidden. */
function answer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="answer"]')
}

/** `[data-slot="answer"]` and every ancestor of it up to (and including) the card. */
function answerChain(container: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  let node = answer(container)
  while (node) {
    chain.push(node)
    if (node.tagName === 'ARTICLE') break
    node = node.parentElement
  }
  return chain
}

/** Structure without inline styles — motion writes the animation onto `style`,
 *  which is precisely the part allowed to differ between motion modes. */
function structure(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('style')
  clone.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'))
  return clone.outerHTML
}

describe('<ReviewCard>', () => {
  it('keeps the question rendered while hidden AND once revealed', () => {
    const { container, rerender } = render(
      <ReviewCard front="Ma question" back="La réponse" revealed={false} reduce={false} />,
    )
    expect(container.querySelector('[data-slot="question"]')).toBeTruthy()
    expect(screen.getByText('Ma question')).toBeTruthy()

    rerender(<ReviewCard front="Ma question" back="La réponse" revealed reduce={false} />)
    expect(container.querySelector('[data-slot="question"]')).toBeTruthy()
    // Exactly once: the vertical reveal killed the verso's question echo.
    expect(screen.getAllByText('Ma question')).toHaveLength(1)
  })

  it('mounts the answer only once revealed', () => {
    const { container, rerender } = render(
      <ReviewCard front="Q" back="La réponse" revealed={false} reduce={false} />,
    )
    expect(answer(container)).toBeNull()
    expect(screen.queryByText('La réponse')).toBeNull()
    expect(container.querySelector('article')?.dataset.revealed).toBe('false')

    rerender(<ReviewCard front="Q" back="La réponse" revealed reduce={false} />)
    expect(answer(container)).toBeTruthy()
    expect(screen.getByText('La réponse')).toBeTruthy()
    expect(container.querySelector('article')?.dataset.revealed).toBe('true')
  })

  // The structural regression this refactor exists to kill: the old verso was
  // `absolute inset-0` over the recto, so the answer was sized by the question.
  // Nothing from the answer node up to the <article> may be taken out of flow.
  it('renders the answer in normal flow — never absolutely positioned', () => {
    const { container } = render(
      <ReviewCard front="Q" back="Une très longue réponse" revealed reduce={false} />,
    )
    const chain = answerChain(container)
    expect(chain.length).toBeGreaterThanOrEqual(3)
    expect(chain.at(-1)?.tagName).toBe('ARTICLE')

    for (const node of chain) {
      // Tailwind utilities (jsdom loads no stylesheet, so the class list is the
      // only faithful source of what the browser would compute).
      const classes = node.className.split(/\s+/)
      expect(classes).not.toContain('absolute')
      expect(classes).not.toContain('fixed')
      expect(classes).not.toContain('inset-0')
      // Inline styles (motion) must not take it out of flow either.
      expect(['', 'static', 'relative']).toContain(getComputedStyle(node).position)
    }
  })

  it('renders a GFM table in the answer', () => {
    const table = '| A | B |\n| - | - |\n| 1 | 2 |'
    const { container } = render(<ReviewCard front="Q" back={table} revealed reduce={false} />)
    const node = answer(container)
    expect(node?.querySelector('table')).toBeTruthy()
    expect(node?.querySelectorAll('th')).toHaveLength(2)
  })

  it('renders the same DOM with and without reduced motion', () => {
    const props = { front: 'Ma question', back: 'La réponse', revealed: true } as const
    const normal = render(<ReviewCard {...props} reduce={false} />)
    const normalHtml = structure(normal.container.querySelector('article') as HTMLElement)
    cleanup()
    const reduced = render(<ReviewCard {...props} reduce />)
    const reducedHtml = structure(reduced.container.querySelector('article') as HTMLElement)
    expect(reducedHtml).toBe(normalHtml)
  })

  describe('tap-to-reveal', () => {
    it('is a button that fires onReveal on click while hidden', () => {
      const onReveal = vi.fn()
      const { container } = render(
        <ReviewCard front="Q" back="A" revealed={false} reduce={false} onReveal={onReveal} />,
      )
      const card = container.querySelector('article') as HTMLElement
      expect(card.getAttribute('role')).toBe('button')
      expect(card.getAttribute('aria-label')).toBeTruthy()
      fireEvent.click(card)
      expect(onReveal).toHaveBeenCalledTimes(1)
    })

    it('drops the button role, the label and the click handler once revealed', () => {
      const onReveal = vi.fn()
      const { container } = render(
        <ReviewCard front="Q" back="A" revealed reduce={false} onReveal={onReveal} />,
      )
      const card = container.querySelector('article') as HTMLElement
      expect(card.getAttribute('role')).toBeNull()
      expect(card.getAttribute('aria-label')).toBeNull()
      fireEvent.click(card)
      expect(onReveal).not.toHaveBeenCalled()
    })

    it('is not a tab stop — keyboard reveal belongs to the session handler', () => {
      const { container } = render(
        <ReviewCard front="Q" back="A" revealed={false} reduce={false} onReveal={vi.fn()} />,
      )
      expect(container.querySelector('article')?.hasAttribute('tabindex')).toBe(false)
    })
  })
})
