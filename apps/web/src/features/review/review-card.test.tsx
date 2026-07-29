// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ParsedQcm } from '@engram/shared'
import { ReviewCard } from './review-card'
import { FLIP_HALF_MS } from './reveal-motion'

/**
 * What a plain (non-QCM) card passes for the multiple-choice props, plus the
 * default reveal — every assertion written before T-046 was written about the
 * unfold, so that is what they keep testing. The other two modes get their own
 * block at the bottom of the file.
 */
const PLAIN = {
  qcm: null,
  selectedChoice: null,
  animation: 'unfold',
  onSelect: () => {},
} as const

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

/** Utility classes of an element — jsdom loads no stylesheet, so the class list
 *  is the only faithful source of what the browser would paint. */
function classesOf(el: Element): string[] {
  return el.className.split(/\s+/)
}

/** Structure without inline styles — motion writes the animation onto `style`,
 *  which is precisely the part allowed to differ between motion modes. */
function structure(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('style')
  clone.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'))
  return clone.outerHTML
}

/** Same, but of what is INSIDE the node — the card's own classes excluded. */
function contents(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[style]').forEach((n) => n.removeAttribute('style'))
  return clone.innerHTML
}

describe('<ReviewCard>', () => {
  it('keeps the question rendered while hidden AND once revealed', () => {
    const { container, rerender } = render(
      <ReviewCard
        {...PLAIN}
        front="Ma question"
        back="La réponse"
        revealed={false}
        reduce={false}
      />,
    )
    expect(container.querySelector('[data-slot="question"]')).toBeTruthy()
    expect(screen.getByText('Ma question')).toBeTruthy()

    rerender(
      <ReviewCard {...PLAIN} front="Ma question" back="La réponse" revealed reduce={false} />,
    )
    expect(container.querySelector('[data-slot="question"]')).toBeTruthy()
    // Exactly once: the vertical reveal killed the verso's question echo.
    expect(screen.getAllByText('Ma question')).toHaveLength(1)
  })

  it('mounts the answer only once revealed', () => {
    const { container, rerender } = render(
      <ReviewCard {...PLAIN} front="Q" back="La réponse" revealed={false} reduce={false} />,
    )
    expect(answer(container)).toBeNull()
    expect(screen.queryByText('La réponse')).toBeNull()
    expect(container.querySelector('article')?.dataset.revealed).toBe('false')

    rerender(<ReviewCard {...PLAIN} front="Q" back="La réponse" revealed reduce={false} />)
    expect(answer(container)).toBeTruthy()
    expect(screen.getByText('La réponse')).toBeTruthy()
    expect(container.querySelector('article')?.dataset.revealed).toBe('true')
  })

  // The structural regression this refactor exists to kill: the old verso was
  // `absolute inset-0` over the recto, so the answer was sized by the question.
  // Nothing from the answer node up to the <article> may be taken out of flow.
  it('renders the answer in normal flow — never absolutely positioned', () => {
    const { container } = render(
      <ReviewCard {...PLAIN} front="Q" back="Une très longue réponse" revealed reduce={false} />,
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
    const { container } = render(
      <ReviewCard {...PLAIN} front="Q" back={table} revealed reduce={false} />,
    )
    const node = answer(container)
    expect(node?.querySelector('table')).toBeTruthy()
    expect(node?.querySelectorAll('th')).toHaveLength(2)
  })

  it('renders the same DOM with and without reduced motion', () => {
    const props = { ...PLAIN, front: 'Ma question', back: 'La réponse', revealed: true } as const
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
        <ReviewCard
          {...PLAIN}
          front="Q"
          back="A"
          revealed={false}
          reduce={false}
          onReveal={onReveal}
        />,
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
        <ReviewCard {...PLAIN} front="Q" back="A" revealed reduce={false} onReveal={onReveal} />,
      )
      const card = container.querySelector('article') as HTMLElement
      expect(card.getAttribute('role')).toBeNull()
      expect(card.getAttribute('aria-label')).toBeNull()
      fireEvent.click(card)
      expect(onReveal).not.toHaveBeenCalled()
    })

    it('is not a tab stop — keyboard reveal belongs to the session handler', () => {
      const { container } = render(
        <ReviewCard
          {...PLAIN}
          front="Q"
          back="A"
          revealed={false}
          reduce={false}
          onReveal={vi.fn()}
        />,
      )
      expect(container.querySelector('article')?.hasAttribute('tabindex')).toBe(false)
    })
  })

  describe('QCM', () => {
    const FRONT = 'Quelle est la capitale du Pérou ?\n\n- A) Cusco\n- B) Lima\n- C) Arequipa'
    const BACK = 'B) Lima, capitale depuis 1535.'
    const QCM: ParsedQcm = {
      question: 'Quelle est la capitale du Pérou ?',
      options: [
        { letter: 'A', text: 'Cusco' },
        { letter: 'B', text: 'Lima' },
        { letter: 'C', text: 'Arequipa' },
      ],
      answerIndex: 1,
      explanation: 'Lima, capitale depuis 1535.',
    }

    function renderQcm(
      props: Partial<{
        qcm: ParsedQcm
        selectedChoice: number | null
        revealed: boolean
        onSelect: (index: number) => void
        onReveal: () => void
      }> = {},
    ) {
      const { qcm = QCM, selectedChoice = null, revealed = false, ...rest } = props
      return render(
        <ReviewCard
          front={FRONT}
          back={BACK}
          qcm={qcm}
          selectedChoice={selectedChoice}
          revealed={revealed}
          reduce={false}
          animation="unfold"
          onSelect={rest.onSelect ?? (() => {})}
          onReveal={rest.onReveal ?? (() => {})}
        />,
      )
    }

    it('renders the question and one enabled button per option while hidden', () => {
      const { container } = renderQcm()
      expect(screen.getByText('Quelle est la capitale du Pérou ?')).toBeTruthy()
      const options = screen.getAllByRole('button')
      expect(options).toHaveLength(3)
      for (const option of options) expect((option as HTMLButtonElement).disabled).toBe(false)
      expect(answer(container)).toBeNull()
      // The options are named by their letter AND their text, even though the
      // two are visually separate.
      expect(screen.getByRole('button', { name: /A\s+Cusco/ })).toBeTruthy()
    })

    // The nested-interactive trap: option buttons inside a `role="button"`
    // <article> would be invalid HTML and unusable at the keyboard.
    it('never makes the card itself a button', () => {
      const onReveal = vi.fn()
      const { container } = renderQcm({ onReveal })
      const card = container.querySelector('article') as HTMLElement
      expect(card.getAttribute('role')).toBeNull()
      expect(card.getAttribute('aria-label')).toBeNull()
      expect(card.className.split(/\s+/)).not.toContain('cursor-pointer')
      fireEvent.click(card)
      expect(onReveal).not.toHaveBeenCalled()
    })

    it('groups the options under a labelled role="group"', () => {
      renderQcm()
      const group = screen.getByRole('group', { name: 'Réponses possibles' })
      expect(group.querySelectorAll('button')).toHaveLength(3)
    })

    it('reports the picked option by index', () => {
      const onSelect = vi.fn()
      renderQcm({ onSelect })
      fireEvent.click(screen.getByRole('button', { name: /Lima/ }))
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('marks the right answer and the wrong pick once revealed, and locks the options', () => {
      const onSelect = vi.fn()
      renderQcm({ revealed: true, selectedChoice: 0, onSelect })

      const wrong = screen.getByRole('button', { name: /Ta réponse, incorrecte/ })
      expect(wrong.textContent).toContain('Cusco')
      expect(classesOf(wrong)).toContain('border-danger')
      // The right answer stays green even though the user missed it, and it is
      // NOT dressed as their own pick.
      const right = screen.getByRole('button', { name: /Bonne réponse/ })
      expect(right.textContent).toContain('Lima')
      expect(classesOf(right)).toContain('border-success')
      expect(screen.queryByRole('button', { name: /Ta réponse, correcte/ })).toBeNull()

      for (const option of screen.getAllByRole('button')) {
        expect((option as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(option)
      }
      expect(onSelect).not.toHaveBeenCalled()
    })

    // The whole point of answering: "I was right" must not render exactly like
    // "here is the answer" (which is what a Space reveal shows).
    it('tells the user their own pick was the right one', () => {
      renderQcm({ revealed: true, selectedChoice: 1 })

      const picked = screen.getByRole('button', { name: /Ta réponse, correcte/ })
      expect(picked.textContent).toContain('Lima')
      // The bare "here is the answer" label must NOT be the one used.
      expect(screen.queryByRole('button', { name: /Bonne réponse/ })).toBeNull()
      // Green, reinforced — readable at a glance next to the Space-reveal case.
      const classes = classesOf(picked)
      expect(classes).toContain('border-success')
      expect(classes).toContain('bg-success-subtle')
      expect(classes).toContain('ring-success')
    })

    it('marks only the right answer when revealed without an answer', () => {
      renderQcm({ revealed: true, selectedChoice: null })
      expect(screen.queryByRole('button', { name: /Ta réponse, incorrecte/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /Ta réponse, correcte/ })).toBeNull()
      const right = screen.getByRole('button', { name: /Bonne réponse/ })
      expect(right.textContent).toContain('Lima')
      // Green, but without the reinforcement reserved for a right pick.
      expect(classesOf(right)).not.toContain('ring-success')
    })

    it('renders the justification under the structural rule', () => {
      const { container } = renderQcm({ revealed: true, selectedChoice: 1 })
      const node = answer(container)
      expect(node).toBeTruthy()
      expect(container.querySelector('hr')).toBeTruthy()
      expect(node?.textContent).toContain('Lima, capitale depuis 1535.')
    })

    it('renders neither the rule nor the answer block when there is no justification', () => {
      const { container } = renderQcm({
        qcm: { ...QCM, explanation: '' },
        revealed: true,
        selectedChoice: 0,
      })
      expect(answer(container)).toBeNull()
      expect(container.querySelector('hr')).toBeNull()
      // The verdict still reads on the options themselves.
      expect(screen.getByRole('button', { name: /Bonne réponse/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Ta réponse, incorrecte/ })).toBeTruthy()
    })
  })
})

/**
 * T-046 — the two reveals that are not the default.
 *
 * A test cannot say whether an animation is *nice*; it can say whether it is
 * wired, and above all what it does to the DOM — which is the part that has
 * consequences for the screen reader and for the reader who has just lost the
 * question. That is what this block is about.
 */
describe('<ReviewCard> — reveal animations', () => {
  const PROPS = { qcm: null, selectedChoice: null, onSelect: () => {} } as const

  describe('flip', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
    afterEach(() => vi.useRealTimers())

    /** Run out the half-turn, so the far face is on screen. */
    function hinge() {
      act(() => {
        vi.advanceTimersByTime(FLIP_HALF_MS)
      })
    }

    it('keeps the question up while the card is still turning away', () => {
      const { container, rerender } = render(
        <ReviewCard
          {...PROPS}
          front="Ma question"
          back="La réponse"
          revealed={false}
          reduce={false}
          animation="flip"
        />,
      )
      rerender(
        <ReviewCard
          {...PROPS}
          front="Ma question"
          back="La réponse"
          revealed
          reduce={false}
          animation="flip"
        />,
      )
      // First half of the turn: the front is still the face pointed at the user,
      // so it must still be the face rendered. Swapping at t=0 would show the
      // answer through the front of the card.
      expect(container.querySelector('[data-slot="question"]')).toBeTruthy()
      expect(screen.queryByText('La réponse')).toBeNull()
    })

    it('replaces the question with the answer at the hinge', () => {
      const { container, rerender } = render(
        <ReviewCard
          {...PROPS}
          front="Ma question"
          back="La réponse"
          revealed={false}
          reduce={false}
          animation="flip"
        />,
      )
      rerender(
        <ReviewCard
          {...PROPS}
          front="Ma question"
          back="La réponse"
          revealed
          reduce={false}
          animation="flip"
        />,
      )
      hinge()
      expect(screen.getByText('La réponse')).toBeTruthy()
      // The question is GONE, and gone from the DOM rather than merely hidden:
      // a face that has turned away must leave the accessibility tree too. This
      // is Alex's explicit call, made knowing it costs the question/answer
      // comparison — a future "fix" that brings the question back is a change of
      // product decision, not a bug fix.
      expect(container.querySelector('[data-slot="question"]')).toBeNull()
      expect(screen.queryByText('Ma question')).toBeNull()
    })

    it('drops the divider with the question it used to divide', () => {
      const { container, rerender } = render(
        <ReviewCard
          {...PROPS}
          front="Q"
          back="A"
          revealed={false}
          reduce={false}
          animation="flip"
        />,
      )
      rerender(
        <ReviewCard {...PROPS} front="Q" back="A" revealed reduce={false} animation="flip" />,
      )
      hinge()
      expect(container.querySelector('hr')).toBeNull()
    })

    it('puts the question back when the next card arrives', () => {
      // The reducer re-renders the same component at ASKING for the next card
      // (`AnimatePresence` keys on the card id, but a re-key is not guaranteed
      // in every path). A face stuck on `back` would show an empty card.
      const { container, rerender } = render(
        <ReviewCard {...PROPS} front="Q1" back="A1" revealed reduce={false} animation="flip" />,
      )
      hinge()
      expect(container.querySelector('[data-slot="question"]')).toBeNull()
      rerender(
        <ReviewCard
          {...PROPS}
          front="Q2"
          back="A2"
          revealed={false}
          reduce={false}
          animation="flip"
        />,
      )
      expect(screen.getByText('Q2')).toBeTruthy()
      expect(screen.queryByText('A2')).toBeNull()
    })

    it('keeps a QCM’s options on the far face — they ARE the verdict', () => {
      const qcm: ParsedQcm = {
        question: 'Capitale du Pérou ?',
        options: [
          { letter: 'A', text: 'Cusco' },
          { letter: 'B', text: 'Lima' },
        ],
        answerIndex: 1,
        explanation: 'Depuis 1535.',
      }
      const props = {
        front: 'x',
        back: 'y',
        qcm,
        selectedChoice: 0,
        onSelect: () => {},
        reduce: false,
        animation: 'flip',
      } as const
      const { rerender } = render(<ReviewCard {...props} revealed={false} />)
      rerender(<ReviewCard {...props} revealed />)
      hinge()
      // Turning the marked options away would hide the answer itself, so the
      // flip on a QCM lands on question + marked options + justification.
      expect(screen.getByText('Capitale du Pérou ?')).toBeTruthy()
      expect(screen.getByRole('button', { name: /Bonne réponse/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Ta réponse, incorrecte/ })).toBeTruthy()
      expect(screen.getByText('Depuis 1535.')).toBeTruthy()
    })

    it('locks a QCM’s options the instant it is revealed, before the marks land', () => {
      const qcm: ParsedQcm = {
        question: 'Q ?',
        options: [
          { letter: 'A', text: 'un' },
          { letter: 'B', text: 'deux' },
        ],
        answerIndex: 1,
        explanation: 'parce que',
      }
      const onSelect = vi.fn()
      const props = {
        front: 'x',
        back: 'y',
        qcm,
        selectedChoice: 0,
        onSelect,
        reduce: false,
        animation: 'flip',
      } as const
      const { rerender } = render(<ReviewCard {...props} revealed={false} />)
      rerender(<ReviewCard {...props} revealed />)
      // Mid-turn: the verdict is not painted yet (that would answer the question
      // 120ms early), but a click must not be accepted either.
      for (const option of screen.getAllByRole('button')) {
        expect((option as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(option)
      }
      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: /Bonne réponse/ })).toBeNull()
    })
  })

  describe('none', () => {
    it('mounts the same content as the unfold — only the movement is gone', () => {
      const props = { ...PROPS, front: 'Ma question', back: 'La réponse', revealed: true } as const
      const unfold = render(<ReviewCard {...props} reduce={false} animation="unfold" />)
      const unfoldHtml = contents(unfold.container.querySelector('article') as HTMLElement)
      cleanup()
      const none = render(<ReviewCard {...props} reduce={false} animation="none" />)
      const noneHtml = contents(none.container.querySelector('article') as HTMLElement)
      // Same nodes, same order, same text. This is what makes `none` the safe
      // target for reduced motion: switching to it changes nothing a screen
      // reader can observe, only what the eye sees moving.
      //
      // Compared INSIDE the card and not on the card itself, because the card's
      // own class list is the one place the two legitimately differ — the unfold
      // deepens the elevation (`shadow-lg`) and `none` does not move at all.
      expect(noneHtml).toBe(unfoldHtml)
      expect(screen.getByText('Ma question')).toBeTruthy()
      expect(screen.getByText('La réponse')).toBeTruthy()
    })

    it('carries no shadow transition — the elevation belongs to the unfold', () => {
      const { container } = render(
        <ReviewCard {...PROPS} front="Q" back="A" revealed reduce={false} animation="none" />,
      )
      const classes = (container.querySelector('article') as HTMLElement).className.split(/\s+/)
      expect(classes).not.toContain('transition-shadow')
      expect(classes).not.toContain('shadow-lg')
    })
  })

  describe('unfold', () => {
    it('deepens the card’s resting elevation once revealed', () => {
      // The lift comes back to zero (see `reveal-motion.ts`); the elevation is
      // the part that STAYS, and it is the only signal left that the card is in
      // its revealed state once the gesture is over.
      const asking = render(
        <ReviewCard
          {...PROPS}
          front="Q"
          back="A"
          revealed={false}
          reduce={false}
          animation="unfold"
        />,
      )
      const askingClasses = (asking.container.querySelector('article') as HTMLElement).className
      expect(askingClasses.split(/\s+/)).toContain('shadow-sm')
      cleanup()
      const revealed = render(
        <ReviewCard {...PROPS} front="Q" back="A" revealed reduce={false} animation="unfold" />,
      )
      const revealedClasses = (revealed.container.querySelector('article') as HTMLElement).className
      expect(revealedClasses.split(/\s+/)).toContain('shadow-lg')
      // Through the design system's own duration token, so the global
      // `prefers-reduced-motion` rule in `styles.css` neutralises it for free.
      expect(revealedClasses.split(/\s+/)).toContain('transition-shadow')
      expect(revealedClasses.split(/\s+/)).toContain('duration-base')
    })
  })
})
