// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    // Recto text (Markdown splits inline code into its own node).
    expect(screen.getByText(/Recto avec/)).toBeTruthy()
    expect(screen.getByText('code')).toBeTruthy()
    expect(screen.getByText('Verso')).toBeTruthy()
  })

  it('renders a GFM table from Markdown', () => {
    const table = '| A | B |\n| - | - |\n| 1 | 2 |'
    const { container } = render(<FlipCard front="front" back={table} revealed reduce={false} />)
    expect(container.querySelector('table')).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
  })
})
