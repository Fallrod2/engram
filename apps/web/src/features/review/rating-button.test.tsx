// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReviewPreview } from '@engram/shared'
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

describe('<RatingBar> — a QCM the user answered', () => {
  const BAR = {
    revealed: true,
    disabled: false,
    flashGrade: null,
    reduce: true,
    onReveal: () => {},
  } as const

  /** Preview shaped like the API response, so the projections are real. */
  const PREVIEW: ReviewPreview = {
    now: '2026-07-01T10:00:00.000Z',
    // scheduledDays 0 → the interval is derived from `due − now`: 10 min.
    again: {
      due: '2026-07-01T10:10:00.000Z',
      stability: 1,
      difficulty: 7,
      scheduledDays: 0,
      state: 3,
    },
    hard: {
      due: '2026-07-03T10:00:00.000Z',
      stability: 2,
      difficulty: 6,
      scheduledDays: 2,
      state: 2,
    },
    good: {
      due: '2026-07-06T10:00:00.000Z',
      stability: 5,
      difficulty: 5,
      scheduledDays: 5,
      state: 2,
    },
    easy: {
      due: '2026-07-13T10:00:00.000Z',
      stability: 12,
      difficulty: 4,
      scheduledDays: 12,
      state: 2,
    },
  }

  it('replaces the four ratings with a single Next button', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} suggestedGrade={3} onRate={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Suivant/ })).toBe(buttons[0])
    for (const name of ['Encore', 'Difficile', 'Bien', 'Facile']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name} —`) })).toBeNull()
    }
  })

  it('spells out the grade it will record and its projected interval', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} suggestedGrade={1} onRate={() => {}} />)
    expect(screen.getByText('Encore')).toBeTruthy()
    const interval = screen.getByText('10 min')
    expect(interval.className).toContain('text-danger')
  })

  it('degrades to the `·` placeholder while the preview is pending', () => {
    render(<RatingBar {...BAR} preview={undefined} suggestedGrade={3} onRate={() => {}} />)
    expect(screen.getByText('Bien')).toBeTruthy()
    expect(screen.getByText('·')).toBeTruthy()
  })

  it('rates with the suggested grade, exactly once, on click', () => {
    const onRate = vi.fn()
    render(<RatingBar {...BAR} preview={PREVIEW} suggestedGrade={1} onRate={onRate} />)
    fireEvent.click(screen.getByRole('button', { name: /^Suivant/ }))
    expect(onRate).toHaveBeenCalledTimes(1)
    expect(onRate).toHaveBeenCalledWith(1)
  })

  it('is inert while a submission is in flight', () => {
    const onRate = vi.fn()
    render(<RatingBar {...BAR} disabled preview={PREVIEW} suggestedGrade={3} onRate={onRate} />)
    const btn = screen.getByRole('button', { name: /^Suivant/ })
    expect(btn).toHaveProperty('disabled', true)
    fireEvent.click(btn)
    expect(onRate).not.toHaveBeenCalled()
  })

  it('keeps the four buttons and shows no Next without a suggestion', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} onRate={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(4)
    for (const name of ['Encore', 'Difficile', 'Bien', 'Facile']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name} —`) })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /^Suivant/ })).toBeNull()
  })

  it('shows the reveal hint once, and nothing else, before the reveal', () => {
    render(
      <RatingBar
        {...BAR}
        revealed={false}
        preview={PREVIEW}
        suggestedGrade={3}
        onRate={() => {}}
      />,
    )
    expect(screen.getAllByText('pour révéler')).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
