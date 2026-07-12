// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RATINGS } from './labels'
import { RatingButton } from './rating-button'

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
