// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReviewPreview } from '@engram/shared'
import { GradeButton } from './rating-button'
import { RatingBar } from './rating-bar'

afterEach(cleanup)

/**
 * §16.2 item 12, amended by T-047.
 *
 * The four self-assessment buttons are gone from the screen; what replaces them
 * is the QCM's own mechanism, generalised. So what these tests pin is no longer
 * "the grid renders four cells" but the contract that made the QCM button
 * acceptable in the first place and that now covers every branch:
 *
 *   · the button says what it will WRITE — the grade, named, plus its projected
 *     interval — because the user is no longer the one choosing it;
 *   · the accessible name says the same three things, and never a key;
 *   · `1`-`4` remain declared (`aria-keyshortcuts`) though never advertised.
 */
describe('<GradeButton>', () => {
  it('prints the claim, the grade it records and the interval in the token color', () => {
    render(
      <GradeButton
        grade={3}
        label="session.verdictRight"
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    const btn = screen.getByRole('button', {
      name: 'J’ai eu juste — noté Bien, prochaine révision dans 10 min',
    })
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('3')
    expect(screen.getByText('J’ai eu juste')).toBeTruthy()
    // The grade is on the button, visibly — not only in the accessible name.
    expect(screen.getByText('Bien')).toBeTruthy()
    expect(screen.getByText('10 min').className).toContain('text-success')
  })

  it('falls back to a `·` placeholder while the preview is pending', () => {
    render(
      <GradeButton
        grade={1}
        label="session.verdictWrong"
        interval={undefined}
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    // Degraded, never silent: the grade is still named, only its consequence is
    // unknown for the moment.
    expect(screen.getByRole('button', { name: 'J’ai eu faux — noté Encore' })).toBeTruthy()
    expect(screen.getByText('·')).toBeTruthy()
  })

  it('applies the token flash classes when pressed', () => {
    render(
      <GradeButton
        grade={3}
        label="session.verdictRight"
        interval="10 min"
        disabled={false}
        flash
        onRate={() => {}}
      />,
    )
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('border-success')
    expect(btn.className).toContain('bg-success-subtle')
  })

  it('shows a keyboard chip only when one is passed', () => {
    render(
      <GradeButton
        grade={3}
        label="session.next"
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    expect(screen.queryByText('Entrée')).toBeNull()
    cleanup()
    render(
      <GradeButton
        grade={3}
        label="session.next"
        shortcut="session.keyEnter"
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={() => {}}
      />,
    )
    expect(screen.getByText('Entrée')).toBeTruthy()
    // …and it stays out of the accessible name either way.
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toContain('Entrée')
  })

  it('fires onRate on click, and is inert when disabled', () => {
    const onRate = vi.fn()
    const { rerender } = render(
      <GradeButton
        grade={3}
        label="session.verdictRight"
        interval="10 min"
        disabled={false}
        flash={false}
        onRate={onRate}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onRate).toHaveBeenCalledTimes(1)
    rerender(
      <GradeButton
        grade={3}
        label="session.verdictRight"
        interval="10 min"
        disabled
        flash={false}
        onRate={onRate}
      />,
    )
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })
})

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

describe('<RatingBar> — a QCM the user answered', () => {
  it('replaces the verdicts with a single Next button', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} suggestedGrade={3} onRate={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Suivant/ })).toBe(buttons[0])
    for (const name of ['J’ai eu faux', 'J’ai eu juste']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull()
    }
  })

  it('spells out the grade it will record and its projected interval', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} suggestedGrade={1} onRate={() => {}} />)
    expect(screen.getByText('Encore')).toBeTruthy()
    expect(screen.getByText('10 min').className).toContain('text-danger')
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

/**
 * T-047 — a plain card asks the question, it does not ask for a self-assessment.
 *
 * The behaviour asserted here is the one Alex asked for after using the app for
 * real: two buttons, "faux" then "juste", the grade deduced and SHOWN, and the
 * four levels still reachable from the keyboard without being on screen (the key
 * router is proven in `use-review-session.test.tsx`; what this file owns is that
 * the bar does not advertise them).
 */
describe('<RatingBar> — a card with no objective evidence', () => {
  it('offers exactly two verdicts, wrong first', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} onRate={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'J’ai eu faux — noté Encore, prochaine révision dans 10 min',
      'J’ai eu juste — noté Bien, prochaine révision dans 5 j',
    ])
  })

  it('records the QCM grades — 1 for wrong, 3 for right — and nothing else', () => {
    const onRate = vi.fn()
    render(<RatingBar {...BAR} preview={PREVIEW} onRate={onRate} />)
    fireEvent.click(screen.getByRole('button', { name: /^J’ai eu faux/ }))
    fireEvent.click(screen.getByRole('button', { name: /^J’ai eu juste/ }))
    expect(onRate.mock.calls).toEqual([[1], [3]])
  })

  it('never puts a `1`-`4` chip on them, while still declaring the keys', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} onRate={() => {}} />)
    for (const key of ['1', '2', '3', '4']) expect(screen.queryByText(key)).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual([
      '1',
      '3',
    ])
  })

  it('shows both projected intervals, each in its own token color', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} onRate={() => {}} />)
    // The intervals were made trustworthy the same morning; a binary gesture is
    // no reason to stop saying what it costs.
    expect(screen.getByText('10 min').className).toContain('text-danger')
    expect(screen.getByText('5 j').className).toContain('text-success')
  })

  it('degrades to `·` on both while the preview is pending', () => {
    render(<RatingBar {...BAR} preview={undefined} onRate={() => {}} />)
    expect(screen.getAllByText('·')).toHaveLength(2)
    expect(screen.getByText('Encore')).toBeTruthy()
    expect(screen.getByText('Bien')).toBeTruthy()
  })

  it('flashes only the grade actually pressed', () => {
    render(<RatingBar {...BAR} preview={PREVIEW} flashGrade={1} onRate={() => {}} />)
    const [wrong, right] = screen.getAllByRole('button')
    expect(wrong!.className.split(/\s+/)).toContain('bg-danger-subtle')
    // Unflashed: the token fill is a `hover:` variant only.
    expect(right!.className.split(/\s+/)).not.toContain('bg-success-subtle')
    cleanup()
    // A hidden `2` corrects in silence — no button claims it.
    render(<RatingBar {...BAR} preview={PREVIEW} flashGrade={2} onRate={() => {}} />)
    for (const btn of screen.getAllByRole('button')) {
      expect(btn.className).toContain('border-border')
    }
  })

  it('is inert while a submission is in flight', () => {
    const onRate = vi.fn()
    render(<RatingBar {...BAR} disabled preview={PREVIEW} onRate={onRate} />)
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toHaveProperty('disabled', true)
      fireEvent.click(btn)
    }
    expect(onRate).not.toHaveBeenCalled()
  })
})
