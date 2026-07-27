// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RATINGS } from './labels'
import { RatingButton } from './rating-button'
import { RatingBar } from './rating-bar'

afterEach(cleanup)

const GOOD = RATINGS[2] // grade 3 · Bien · success

describe('<RatingButton> (§16.2 item 12)', () => {
  it('shows the Kbd, the FR label and the interval in the token color', () => {
    render(
      <RatingButton
        meta={GOOD}
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    const btn = screen.getByRole('button', {
      name: 'Bien — prochaine révision dans 10 min',
    })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('3')
    expect(screen.getByText('3')).toBeTruthy() // Kbd
    expect(screen.getByText('Bien')).toBeTruthy()
    const interval = screen.getByText('10 min')
    expect(interval.className).toContain('text-success')
  })

  it('falls back to a `·` placeholder while the preview is pending', () => {
    render(
      <RatingButton
        meta={GOOD}
        interval={undefined}
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: 'Bien — noter cette carte' })
    expect(btn).toBeTruthy()
    const placeholder = screen.getByText('·')
    expect(placeholder.className).toContain('text-text-faint')
  })

  it('applies the token flash classes when pressed', () => {
    render(<RatingButton meta={GOOD} interval="10 min" disabled={false} flash onRate={() => {}} />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('border-success')
    expect(btn.className).toContain('bg-success-subtle')
  })

  it('fires onRate on click, and is inert when disabled', () => {
    const onRate = vi.fn()
    const { rerender } = render(
      <RatingButton meta={GOOD} interval="10 min" disabled={false} flash={false} onRate={onRate} />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onRate).toHaveBeenCalledTimes(1)
    rerender(<RatingButton meta={GOOD} interval="10 min" disabled flash={false} onRate={onRate} />)
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })
})

describe('<RatingButton> — the grade suggested by a QCM result', () => {
  it('appends the mention to the accessible name and rings the button', () => {
    render(
      <RatingButton
        meta={GOOD}
        interval="10 min"
        disabled={false}
        flash={false}
        suggested
        onRate={() => {}}
      />,
    )
    // The name still STARTS with the rating label — `reviewAllGood` (e2e) finds
    // this button with `/^Bien/`, so the mention may only ever be a suffix.
    const btn = screen.getByRole('button', {
      name: 'Bien — prochaine révision dans 10 min, suggéré',
    })
    expect(btn.className).toContain('ring-success')
  })

  it('renders exactly as before when it is not the suggested grade', () => {
    const { container } = render(
      <RatingButton
        meta={GOOD}
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    const plain = container.innerHTML
    cleanup()
    const explicit = render(
      <RatingButton
        meta={GOOD}
        interval="10 min"
        disabled={false}
        flash={false}
        suggested={false}
        onRate={() => {}}
      />,
    )
    expect(explicit.container.innerHTML).toBe(plain)
    expect(plain).not.toContain('suggéré')
    expect(plain).not.toContain('ring-success')
  })
})

describe('<RatingBar> — wiring the suggestion', () => {
  const BAR = {
    revealed: true,
    preview: undefined,
    disabled: false,
    flashGrade: null,
    reduce: true,
    onReveal: () => {},
    onRate: () => {},
  } as const

  it('marks only the suggested grade', () => {
    render(<RatingBar {...BAR} suggestedGrade={3} />)
    expect(screen.getByRole('button', { name: 'Bien — noter cette carte, suggéré' })).toBeTruthy()
    for (const name of ['Encore', 'Difficile', 'Facile']) {
      const btn = screen.getByRole('button', { name: `${name} — noter cette carte` })
      expect(btn.className).not.toContain('ring-')
    }
  })

  it('marks nothing at all without a suggestion', () => {
    const { container } = render(<RatingBar {...BAR} />)
    expect(container.innerHTML).not.toContain('suggéré')
    expect(container.innerHTML).not.toContain('ring-')
  })
})
