// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SubjectDot } from './subject-dot'

afterEach(cleanup)

describe('<SubjectDot> pigment resolution (spec §1.10 / §2)', () => {
  it('resolves a canonical hex to its themeable pigment utility (no inline color)', () => {
    const { container } = render(<SubjectDot color="#7999f5" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('bg-subject-1')
    expect(dot.style.background).toBe('')
    expect(dot.className).toContain('rounded-full')
  })

  it('falls back to a raw inline color for a non-canonical hex', () => {
    const { container } = render(<SubjectDot color="#123456" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).not.toContain('bg-subject-')
    // The raw hex is applied inline (exact serialization varies by engine).
    expect(dot.style.background).not.toBe('')
  })

  it('desaturates when muted (archived subject)', () => {
    const { container } = render(<SubjectDot color="#7999f5" muted />)
    expect((container.firstElementChild as HTMLElement).className).toContain('opacity-40')
  })
})
