// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReviewCounts } from '@/features/generations/review-machine'
import { ReviewFooterBar } from './review-footer-bar'

afterEach(cleanup)

function counts(over: Partial<ReviewCounts> = {}): ReviewCounts {
  return { accepted: 0, edited: 0, rejected: 0, pending: 0, toInsert: 0, ...over }
}

describe('ReviewFooterBar', () => {
  it('shows the pluralized insert count and enables the button', () => {
    const onInsert = vi.fn()
    render(
      <ReviewFooterBar
        counts={counts({ accepted: 2, edited: 1, toInsert: 3 })}
        onInsert={onInsert}
        insertPending={false}
      />,
    )
    const btn = screen.getByRole('button', { name: /Insérer 3 cartes/ })
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onInsert).toHaveBeenCalled()
  })

  it('disables the button when nothing is selected', () => {
    render(<ReviewFooterBar counts={counts()} onInsert={vi.fn()} insertPending={false} />)
    expect(screen.getByRole('button', { name: /Insérer 0 carte/ })).toHaveProperty('disabled', true)
  })

  it('shows an inserting state', () => {
    render(
      <ReviewFooterBar
        counts={counts({ accepted: 1, toInsert: 1 })}
        onInsert={vi.fn()}
        insertPending
      />,
    )
    expect(screen.getByRole('button', { name: /Insertion…/ })).toHaveProperty('disabled', true)
  })
})
