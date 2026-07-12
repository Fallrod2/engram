// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DayLoad } from './day-load'
import { LoadMeter } from './load-meter'

afterEach(cleanup)

/** No engram token is ever red/rating/accent-tinted for load (spec §7.1). */
function assertNeverRedOrAccent(el: HTMLElement) {
  const html = el.outerHTML
  expect(html).not.toContain('bg-danger')
  expect(html).not.toContain('text-danger')
  expect(html).not.toContain('bg-accent')
  expect(html).not.toMatch(/bg-subject-/) // load is monochrome, never a series tint
}

describe('<DayLoad> tiers (spec §7.1)', () => {
  it('renders a retreating `·` in text-faint at zero, no meter', () => {
    const { container } = render(<DayLoad value={0} max={20} />)
    const el = screen.getByLabelText('0 review prévue')
    expect(el.textContent).toBe('·')
    expect(el.className).toContain('text-text-faint')
    expect(container.querySelector('.bg-surface-3')).toBeNull()
    assertNeverRedOrAccent(el)
  })

  it('renders the number in text-muted for the low tier (1–20) with a meter', () => {
    const { container } = render(<DayLoad value={12} max={40} />)
    const wrapper = screen.getByLabelText('12 reviews prévues')
    expect(wrapper.firstElementChild?.textContent).toBe('12')
    expect((wrapper.firstElementChild as HTMLElement).className).toContain('text-text-muted')
    expect(container.querySelector('.bg-surface-3')).not.toBeNull()
    assertNeverRedOrAccent(container.firstElementChild as HTMLElement)
  })

  it('renders the number in primary text for higher tiers', () => {
    render(<DayLoad value={35} max={40} />)
    const number = screen.getByLabelText('35 reviews prévues').firstElementChild as HTMLElement
    expect(number.className).toContain('text-text')
    expect(number.className).not.toContain('text-text-muted')
  })
})

describe('<LoadMeter> length (spec §7.1)', () => {
  it('fills proportionally, clamped at 100%, monochrome', () => {
    const { container, rerender } = render(<LoadMeter value={10} max={40} />)
    const fill = () => container.querySelector('.bg-text-faint') as HTMLElement
    expect(fill().style.width).toBe('25%')
    rerender(<LoadMeter value={80} max={40} />)
    expect(fill().style.width).toBe('100%')
    assertNeverRedOrAccent(container.firstElementChild as HTMLElement)
  })

  it('is empty (0%) when max is zero', () => {
    const { container } = render(<LoadMeter value={5} max={0} />)
    expect((container.querySelector('.bg-text-faint') as HTMLElement).style.width).toBe('0%')
  })
})
