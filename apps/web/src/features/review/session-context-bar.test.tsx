// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionContextBar } from './session-context-bar'

afterEach(cleanup)

const NOOP = () => {}

describe('<SessionContextBar> remaining counters', () => {
  it('reads as "state count" pairs in FSRS order', () => {
    render(
      <SessionContextBar
        remaining={{ new: 3, learning: 1, review: 12, relearning: 0 }}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const group = screen.getByRole('group', { name: 'Cartes restantes par état' })
    expect(group.textContent).toBe('Nouvelle3Apprentissage1Révision12Réapprentissage0')
  })

  it('dims a zero and keeps a non-zero legible', () => {
    render(
      <SessionContextBar
        remaining={{ new: 0, learning: 2, review: 0, relearning: 0 }}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const group = screen.getByRole('group', { name: 'Cartes restantes par état' })
    const values = [...group.querySelectorAll('span > span:last-child')]
    expect(values.map((v) => v.textContent)).toEqual(['0', '2', '0', '0'])
    expect(values[0]?.className).toContain('text-text-faint')
    expect(values[1]?.className).not.toContain('text-text-faint')
  })
})

describe('<SessionContextBar> skip action', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  it('exposes the skip button under its full aria-label (label may be hidden)', () => {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const button = screen.getByRole('button', {
      name: 'Passer cette carte sans la noter (S)',
    })
    expect(button.getAttribute('type')).toBe('button')
  })

  it('calls onSkip on click', () => {
    const onSkip = vi.fn()
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={onSkip}
        onUndo={NOOP}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Passer cette carte sans la noter (S)' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})

describe('<SessionContextBar> edit action', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  it('exposes the edit button under its full aria-label (label may be hidden)', () => {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const button = screen.getByRole('button', { name: 'Éditer cette carte (E)' })
    expect(button.getAttribute('type')).toBe('button')
  })

  it('calls onEdit on click', () => {
    const onEdit = vi.fn()
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={onEdit}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Éditer cette carte (E)' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('sits before "Passer" in the left slot (Annuler · Éditer · Passer)', () => {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Éditer cette carte (E)', 'Passer cette carte sans la noter (S)'])
  })
})

describe('<SessionContextBar> undo action', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  it('renders nothing when there is no rating to take back', () => {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Annuler la dernière note (U)' })).toBeNull()
  })

  it('appears under its full aria-label once a rating is undoable, first in the row', () => {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
    const button = screen.getByRole('button', { name: 'Annuler la dernière note (U)' })
    expect(button.getAttribute('type')).toBe('button')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Annuler la dernière note (U)',
      'Éditer cette carte (E)',
      'Passer cette carte sans la noter (S)',
    ])
  })

  it('calls onUndo on click', () => {
    const onUndo = vi.fn()
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={onUndo}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la dernière note (U)' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('is disabled — and unclickable — while the undo is in flight', () => {
    const onUndo = vi.fn()
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo
        undoing
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={onUndo}
      />,
    )
    const button = screen.getByRole('button', { name: 'Annuler la dernière note (U)' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(onUndo).not.toHaveBeenCalled()
  })
})

describe('<SessionContextBar> affordance while an undo is in flight', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  // The realistic combination: the hook computes `canUndo = lastReview !== null && !undoing`,
  // so an in-flight undo means the "Annuler" button is not rendered at all.
  it('disables "Éditer" and "Passer" — and swallows no click', () => {
    const onEdit = vi.fn()
    const onSkip = vi.fn()
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={null}
        canUndo={false}
        undoing
        onEdit={onEdit}
        onSkip={onSkip}
        onUndo={NOOP}
      />,
    )
    const edit = screen.getByRole('button', { name: 'Éditer cette carte (E)' })
    const skip = screen.getByRole('button', { name: 'Passer cette carte sans la noter (S)' })
    expect((edit as HTMLButtonElement).disabled).toBe(true)
    expect((skip as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(edit)
    fireEvent.click(skip)
    expect(onEdit).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
  })
  // The `undoing: false` control already exists above: "calls onEdit on click" and
  // "calls onSkip on click" both fail if the buttons were disabled unconditionally,
  // since a disabled button fires no click handler.
})

describe('<SessionContextBar> difficulty gauge', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  function renderWith(difficulty: number | null) {
    render(
      <SessionContextBar
        remaining={remaining}
        difficulty={difficulty}
        canUndo={false}
        undoing={false}
        onEdit={NOOP}
        onSkip={NOOP}
        onUndo={NOOP}
      />,
    )
  }

  /** Segments lit up, read off the fill token rather than off a count of nodes. */
  function filledCount(): number {
    const gauge = screen.getByRole('img')
    return gauge.querySelectorAll('.bg-text-muted').length
  }

  it('fills every segment at the top of the scale', () => {
    renderWith(10)
    expect(filledCount()).toBe(5)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Difficulté de cette carte : 10 sur 10',
    )
  })

  it('fills a single segment at the bottom of the scale', () => {
    renderWith(1)
    expect(filledCount()).toBe(1)
  })

  it('rounds the spoken value to one decimal', () => {
    renderWith(5.4)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Difficulté de cette carte : 5.4 sur 10',
    )
    cleanup()
    // The value ts-fsrs actually writes: two decimals, spoken with one.
    renderWith(5.37)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Difficulté de cette carte : 5.4 sur 10',
    )
  })

  // The trap `weightFor` documents: `difficulty` is 0 until the first review, so
  // a new card is UNKNOWN, not easy — an empty gauge, never a difficulty of 1.
  it('leaves the gauge empty and says so on a never-reviewed card', () => {
    renderWith(0)
    expect(filledCount()).toBe(0)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Difficulté de cette carte : pas encore évaluée',
    )
  })

  it('renders nothing at all when there is no current card', () => {
    renderWith(null)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
