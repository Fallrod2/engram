// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Kbd } from './kbd'

afterEach(cleanup)

describe('<Kbd> (spec §8)', () => {
  it('renders a mono <kbd> chip with its key', () => {
    render(<Kbd>n</Kbd>)
    const chip = screen.getByText('n')
    expect(chip.tagName).toBe('KBD')
    expect(chip.className).toContain('font-mono')
  })

  it('forwards extra class names and renders short chords', () => {
    render(<Kbd className="ml-1">⌘↵</Kbd>)
    const chip = screen.getByText('⌘↵')
    expect(chip.className).toContain('ml-1')
  })
})
