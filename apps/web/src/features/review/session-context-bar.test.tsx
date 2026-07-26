// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SessionContextBar } from './session-context-bar'

afterEach(cleanup)

describe('<SessionContextBar> remaining counters', () => {
  it('reads as "state count" pairs in FSRS order', () => {
    render(<SessionContextBar remaining={{ new: 3, learning: 1, review: 12, relearning: 0 }} />)
    const group = screen.getByRole('group', { name: 'Cartes restantes par état' })
    expect(group.textContent).toBe('Nouvelle3Apprentissage1Révision12Réapprentissage0')
  })

  it('dims a zero and keeps a non-zero legible', () => {
    render(<SessionContextBar remaining={{ new: 0, learning: 2, review: 0, relearning: 0 }} />)
    const group = screen.getByRole('group', { name: 'Cartes restantes par état' })
    const values = [...group.querySelectorAll('span > span:last-child')]
    expect(values.map((v) => v.textContent)).toEqual(['0', '2', '0', '0'])
    expect(values[0]?.className).toContain('text-text-faint')
    expect(values[1]?.className).not.toContain('text-text-faint')
  })
})
