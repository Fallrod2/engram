// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FlipCard } from './flip-card'

afterEach(cleanup)

describe('<FlipCard> (§16.2 item 13)', () => {
  it('renders a 3D flip with normal motion', () => {
    const { container } = render(
      <FlipCard front="Recto" back="Verso" revealed={false} reduce={false} />,
    )
    expect(container.querySelector('[data-mode="flip"]')).toBeTruthy()
    expect(container.querySelector('[data-mode="crossfade"]')).toBeNull()
  })

  it('renders a crossfade (no rotateY) under reduced motion', () => {
    const { container } = render(<FlipCard front="Recto" back="Verso" revealed={false} reduce />)
    expect(container.querySelector('[data-mode="crossfade"]')).toBeTruthy()
    expect(container.querySelector('[data-mode="flip"]')).toBeNull()
  })

  it('renders both faces through the Markdown renderer', () => {
    render(<FlipCard front="Recto avec `code`" back="Verso" revealed reduce={false} />)
    // The recto shows twice: on the front face AND as the question recall on the
    // verso (fix-session §2), so match with getAllByText.
    expect(screen.getAllByText(/Recto avec/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('code').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Verso')).toBeTruthy()
  })

  it('renders a GFM table from Markdown', () => {
    const table = '| A | B |\n| - | - |\n| 1 | 2 |'
    const { container } = render(<FlipCard front="front" back={table} revealed reduce={false} />)
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
  })

  // fix-session §2 — the verso keeps the question visible so the rating is never blind.
  it('echoes the question on the verso when revealed', () => {
    render(<FlipCard front="Ma question" back="La réponse" revealed reduce={false} />)
    expect(screen.getByLabelText(/rappel de la question/i)).toBeTruthy()
    expect(screen.getByText('La réponse')).toBeTruthy()
  })

  // fix-session §1 — reveal must work at the finger (tap/click), not only via Space.
  describe('tap-to-reveal (fix-session §1)', () => {
    it('is a button that fires onReveal on click while face-down', () => {
      const onReveal = vi.fn()
      const { container } = render(
        <FlipCard front="Q" back="A" revealed={false} reduce={false} onReveal={onReveal} />,
      )
      const card = container.querySelector('[data-mode="flip"]') as HTMLElement
      expect(card.getAttribute('role')).toBe('button')
      fireEvent.click(card)
      expect(onReveal).toHaveBeenCalledTimes(1)
    })

    it('also fires under reduced motion (crossfade mode)', () => {
      const onReveal = vi.fn()
      const { container } = render(
        <FlipCard front="Q" back="A" revealed={false} reduce onReveal={onReveal} />,
      )
      const card = container.querySelector('[data-mode="crossfade"]') as HTMLElement
      expect(card.getAttribute('role')).toBe('button')
      fireEvent.click(card)
      expect(onReveal).toHaveBeenCalledTimes(1)
    })

    it('drops the button role and click handler once revealed', () => {
      const onReveal = vi.fn()
      const { container } = render(
        <FlipCard front="Q" back="A" revealed reduce={false} onReveal={onReveal} />,
      )
      const card = container.querySelector('[data-mode="flip"]') as HTMLElement
      expect(card.getAttribute('role')).toBeNull()
      fireEvent.click(card)
      expect(onReveal).not.toHaveBeenCalled()
    })
  })
})
