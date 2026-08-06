// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DatePicker, parseTypedDay } from './date-picker'

/**
 * T-036 — the exam date is TYPEABLE. It used to be a button and a grid of
 * buttons and nothing else: setting a date three months out meant three clicks
 * on a chevron, and setting one you already knew meant navigating to it.
 */
afterEach(cleanup)

const JULY_28 = new Date(2026, 6, 28)

function renderPicker(onChange = vi.fn(), value = JULY_28) {
  render(<DatePicker value={value} onChange={onChange} />)
  return { onChange, input: screen.getByRole('textbox') as HTMLInputElement }
}

describe('parseTypedDay — what counts as a day', () => {
  it('accepts the app-wide YYYY-MM-DD form', () => {
    const d = parseTypedDay('2026-08-15')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(7)
    expect(d?.getDate()).toBe(15)
  })

  it('refuses a day that does not exist rather than rolling it over', () => {
    // `parseDayKey` alone would answer March 3rd here, and silently moving
    // somebody's exam is worse than refusing what they typed.
    expect(parseTypedDay('2026-02-31')).toBeNull()
    expect(parseTypedDay('2026-13-01')).toBeNull()
    expect(parseTypedDay('2026-00-10')).toBeNull()
  })

  it('refuses anything that is not the exact shape', () => {
    for (const bad of ['', '2026-8-15', '15/08/2026', '2026-08-15x', 'demain']) {
      expect(parseTypedDay(bad), bad).toBeNull()
    }
  })

  it('tolerates surrounding whitespace (a paste)', () => {
    expect(parseTypedDay('  2026-08-15 ')).not.toBeNull()
  })
})

describe('<DatePicker> typing', () => {
  it('shows the current value as a day key a keyboard can edit', () => {
    const { input } = renderPicker()
    expect(input.value).toBe('2026-07-28')
  })

  it('commits a typed date without ever opening the calendar', () => {
    const { onChange, input } = renderPicker()
    fireEvent.change(input, { target: { value: '2026-12-03' } })
    const committed = onChange.mock.calls.at(-1)?.[0] as Date
    expect(committed.getFullYear()).toBe(2026)
    expect(committed.getMonth()).toBe(11)
    expect(committed.getDate()).toBe(3)
  })

  it('keeps a half-typed date on screen but does NOT commit it', () => {
    const { onChange, input } = renderPicker()
    fireEvent.change(input, { target: { value: '2026-12' } })
    expect(input.value).toBe('2026-12') // still editable, not snatched away
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('snaps back to the real value when an unfinished date loses focus', () => {
    const { onChange, input } = renderPicker()
    fireEvent.change(input, { target: { value: '2026-1' } })
    fireEvent.blur(input)
    expect(input.value).toBe('2026-07-28')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('follows a value changed from outside (the grid, a form reset)', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DatePicker value={JULY_28} onChange={onChange} />)
    rerender(<DatePicker value={new Date(2026, 8, 1)} onChange={onChange} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2026-09-01')
  })

  it('still offers the calendar, now as its own labelled control', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: 'Ouvrir le calendrier' })).toBeTruthy()
  })
})
