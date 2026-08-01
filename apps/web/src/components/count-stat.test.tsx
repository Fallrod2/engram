// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CountStat } from './count-stat'

afterEach(cleanup)

/**
 * T-042 — three states, and the third one is new. A counter has always had two
 * renderings: a figure, and a shimmer for `value === undefined`. A shimmer is
 * itself a claim ("it is coming"), and it is false once the read has failed:
 * the cell then shimmers for ever and the screen reads as busy, not broken.
 */
describe('<CountStat> (T-042)', () => {
  it('prints the figure it was given', () => {
    render(<CountStat value={12} />)
    expect(screen.getByText('12')).toBeTruthy()
  })

  it('shimmers while the read is in flight', () => {
    const { container } = render(<CountStat value={undefined} />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.textContent).toBe('')
  })

  it('prints a named em-dash — not a shimmer, not a zero — for a failed read', () => {
    const { container } = render(<CountStat value={undefined} unknown />)
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(screen.getByLabelText('Valeur indisponible').textContent).toBe('—')
    expect(screen.queryByText('0')).toBeNull()
  })
})
