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
        onEdit={NOOP}
        onSkip={NOOP}
      />,
    )
    const group = screen.getByRole('group', { name: 'Cartes restantes par état' })
    expect(group.textContent).toBe('Nouvelle3Apprentissage1Révision12Réapprentissage0')
  })

  it('dims a zero and keeps a non-zero legible', () => {
    render(
      <SessionContextBar
        remaining={{ new: 0, learning: 2, review: 0, relearning: 0 }}
        onEdit={NOOP}
        onSkip={NOOP}
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
    render(<SessionContextBar remaining={remaining} onEdit={NOOP} onSkip={NOOP} />)
    const button = screen.getByRole('button', {
      name: 'Passer cette carte sans la noter (S)',
    })
    expect(button.getAttribute('type')).toBe('button')
  })

  it('calls onSkip on click', () => {
    const onSkip = vi.fn()
    render(<SessionContextBar remaining={remaining} onEdit={NOOP} onSkip={onSkip} />)
    fireEvent.click(screen.getByRole('button', { name: 'Passer cette carte sans la noter (S)' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })
})

describe('<SessionContextBar> edit action', () => {
  const remaining = { new: 1, learning: 0, review: 0, relearning: 0 }

  it('exposes the edit button under its full aria-label (label may be hidden)', () => {
    render(<SessionContextBar remaining={remaining} onEdit={NOOP} onSkip={NOOP} />)
    const button = screen.getByRole('button', { name: 'Éditer cette carte (E)' })
    expect(button.getAttribute('type')).toBe('button')
  })

  it('calls onEdit on click', () => {
    const onEdit = vi.fn()
    render(<SessionContextBar remaining={remaining} onEdit={onEdit} onSkip={NOOP} />)
    fireEvent.click(screen.getByRole('button', { name: 'Éditer cette carte (E)' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('sits before "Passer" in the left slot (Annuler · Éditer · Passer)', () => {
    render(<SessionContextBar remaining={remaining} onEdit={NOOP} onSkip={NOOP} />)
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Éditer cette carte (E)', 'Passer cette carte sans la noter (S)'])
  })
})
