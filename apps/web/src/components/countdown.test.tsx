// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Countdown } from './countdown'

afterEach(cleanup)

const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()
const now = new Date(2026, 6, 12, 10)

describe('<Countdown> (spec §1.8) — proximity, never red', () => {
  it('shows J-n in text-muted for a future exam', () => {
    const { container } = render(<Countdown dateIso={iso(2026, 6, 17)} now={now} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.textContent).toBe('J-5')
    expect(el.className).toContain('text-text-muted')
    expect(el.outerHTML).not.toContain('danger')
  })

  it("shows aujourd'hui in accent for the exam day (never red)", () => {
    const { container } = render(<Countdown dateIso={iso(2026, 6, 12, 23)} now={now} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.textContent).toBe("aujourd'hui")
    expect(el.className).toContain('text-accent')
    expect(el.outerHTML).not.toContain('danger')
  })

  it('shows passé in text-faint for a past exam', () => {
    const { container } = render(<Countdown dateIso={iso(2026, 6, 10)} now={now} />)
    const el = container.firstElementChild as HTMLElement
    expect(el.textContent).toBe('passé')
    expect(el.className).toContain('text-text-faint')
  })

  it('is always mono tabular', () => {
    const { container } = render(<Countdown dateIso={iso(2026, 6, 17)} now={now} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('font-mono')
    expect((container.firstElementChild as HTMLElement).className).toContain('tabular-nums')
  })
})
