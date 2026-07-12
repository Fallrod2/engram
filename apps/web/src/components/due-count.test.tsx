// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DueCount, DueBadge } from './due-count'

afterEach(cleanup)

describe('<DueCount> intensity encoding (design §6.1)', () => {
  it('renders a retreating `·` in text-faint at zero', () => {
    render(<DueCount value={0} />)
    const el = screen.getByLabelText('0 à réviser')
    expect(el.textContent).toBe('·')
    expect(el.className).toContain('text-text-faint')
  })

  it('renders the number in text-muted for the low tier (1–20)', () => {
    const { container } = render(<DueCount value={12} />)
    const wrapper = screen.getByLabelText('12 à réviser')
    const number = wrapper.firstElementChild as HTMLElement
    expect(number.textContent).toBe('12')
    expect(number.className).toContain('text-text-muted')
    // No load bar below the high threshold.
    expect(container.querySelector('.w-8')).toBeNull()
  })

  it('renders the number in primary text for the mid tier (21–50), no bar', () => {
    const { container } = render(<DueCount value={35} />)
    const number = screen.getByLabelText('35 à réviser').firstElementChild as HTMLElement
    expect(number.textContent).toBe('35')
    expect(number.className).toContain('text-text')
    expect(number.className).not.toContain('text-text-muted')
    expect(container.querySelector('.w-8')).toBeNull()
  })

  it('adds a subject-tinted load bar for the high tier (>50) when a color is given', () => {
    const { container } = render(<DueCount value={120} colorHex="#7999f5" />)
    expect(screen.getByLabelText('120 à réviser').firstElementChild?.textContent).toBe('120')
    const bar = container.querySelector('.w-8')
    expect(bar).not.toBeNull()
    // Canonical hex resolves to the themeable pigment utility (never a raw color).
    expect(bar?.querySelector('.bg-subject-1')).not.toBeNull()
  })

  it('omits the load bar in the high tier when no color is supplied (neutral total)', () => {
    const { container } = render(<DueCount value={120} />)
    expect(container.querySelector('.w-8')).toBeNull()
  })
})

describe('<DueBadge> collapsed-sidebar variant (spec §5)', () => {
  it('hides at zero (the calm `·` has no badge form)', () => {
    const { container } = render(<DueBadge value={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('caps overflow at 99+', () => {
    render(<DueBadge value={150} />)
    expect(screen.getByText('99+')).toBeTruthy()
  })
})
