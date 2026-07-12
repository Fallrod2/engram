// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ReviewItem } from '@/features/generations/review-machine'
import { ProposalCard } from './proposal-card'

afterEach(cleanup)

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'i1',
    front: 'Question ?',
    back: 'Réponse.',
    status: 'pending',
    frozen: false,
    cardId: undefined,
    history: [],
    ...over,
  }
}

const noop = () => {}
const handlers = {
  onAccept: noop,
  onReject: noop,
  onEdit: noop,
  onUndo: noop,
  onStartEdit: noop,
  onCancelEdit: noop,
}

describe('ProposalCard — monochrome encoding (spec §5)', () => {
  it('never uses a rating hue for accept/reject status', () => {
    const { container } = render(
      <ProposalCard
        item={item({ status: 'accepted' })}
        index={1}
        cursorActive
        editing={false}
        rowProps={{ tabIndex: 0 }}
        {...handlers}
      />,
    )
    // No danger/success/warning/info fills or text anywhere in the card.
    expect(
      container.querySelector(
        '[class*="danger"], [class*="success"], [class*="warning"], [class*="bg-info"]',
      ),
    ).toBeNull()
    // Accepted glyph is the neutral filled square.
    expect(container.querySelector('.bg-text')).not.toBeNull()
  })

  it('renders recto/verso content and strikes a rejected card', () => {
    const { container } = render(
      <ProposalCard
        item={item({ status: 'rejected' })}
        index={3}
        cursorActive={false}
        editing={false}
        rowProps={{ tabIndex: -1 }}
        {...handlers}
      />,
    )
    expect(screen.getByText('Question ?')).toBeTruthy()
    expect(screen.getByText('Réponse.')).toBeTruthy()
    expect(container.querySelector('.line-through')).not.toBeNull()
  })
})

describe('ProposalCard — inline edit (spec §4.4)', () => {
  it('⌘↵ saves trimmed front/back via onEdit', () => {
    const onEdit = vi.fn()
    render(
      <ProposalCard
        item={item()}
        index={1}
        cursorActive
        editing
        rowProps={{ tabIndex: 0 }}
        {...handlers}
        onEdit={onEdit}
      />,
    )
    const recto = screen.getByLabelText('Recto') as HTMLTextAreaElement
    const verso = screen.getByLabelText('Verso') as HTMLTextAreaElement
    fireEvent.change(recto, { target: { value: '  New Q  ' } })
    fireEvent.change(verso, { target: { value: 'New A' } })
    fireEvent.keyDown(verso, { key: 'Enter', metaKey: true })
    expect(onEdit).toHaveBeenCalledWith('New Q', 'New A')
  })

  it('blocks save and flags the empty field', () => {
    const onEdit = vi.fn()
    render(
      <ProposalCard
        item={item()}
        index={1}
        cursorActive
        editing
        rowProps={{ tabIndex: 0 }}
        {...handlers}
        onEdit={onEdit}
      />,
    )
    const verso = screen.getByLabelText('Verso') as HTMLTextAreaElement
    fireEvent.change(verso, { target: { value: '   ' } })
    fireEvent.keyDown(verso, { key: 'Enter', metaKey: true })
    expect(onEdit).not.toHaveBeenCalled()
    expect(verso.getAttribute('aria-invalid')).toBe('true')
  })

  it('Esc cancels the edit', () => {
    const onCancelEdit = vi.fn()
    render(
      <ProposalCard
        item={item()}
        index={1}
        cursorActive
        editing
        rowProps={{ tabIndex: 0 }}
        {...handlers}
        onCancelEdit={onCancelEdit}
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('Recto'), { key: 'Escape' })
    expect(onCancelEdit).toHaveBeenCalled()
  })
})
