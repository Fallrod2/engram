// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CardSearchHit } from '@engram/shared'
import { BulkDeleteConfirm } from './bulk-delete-confirm'

afterEach(cleanup)

function hit(id: string, reps: number): CardSearchHit {
  return {
    card: {
      id,
      deckId: 'deck1',
      front: `front ${id}`,
      back: 'back',
      fsrs: {
        due: '2026-07-30T00:00:00.000Z',
        stability: 4,
        difficulty: 6,
        elapsedDays: 2,
        scheduledDays: 5,
        learningSteps: 0,
        reps,
        lapses: 0,
        state: reps > 0 ? 2 : 0,
        lastReview: reps > 0 ? '2026-07-25T00:00:00.000Z' : null,
      },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    deck: { id: 'deck1', name: 'Automates' },
    subject: { id: 'sub1', name: 'TL', color: '#7999f5', icon: 'brain', archived: false },
  }
}

function renderConfirm(hits: CardSearchHit[], onConfirm = vi.fn(), count = hits.length) {
  render(
    <BulkDeleteConfirm
      open
      onOpenChange={() => {}}
      count={count}
      hits={hits}
      onConfirm={onConfirm}
    />,
  )
  return onConfirm
}

/**
 * A bulk delete destroys review history that took weeks to accumulate, and it
 * is not undoable. "Êtes-vous sûr ?" would be worth nothing here: the dialog
 * has to say how many, what goes with them, and that it is final.
 */
describe('<BulkDeleteConfirm>', () => {
  it('names the exact number of cards, in the title and on the button', () => {
    renderConfirm([hit('a', 0), hit('b', 0), hit('c', 0)])
    expect(screen.getByText('Supprimer 3 cartes ?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Supprimer 3 cartes' })).toBeTruthy()
  })

  it('spells out the review history that goes with them', () => {
    renderConfirm([hit('a', 12), hit('b', 5), hit('c', 0)])
    expect(
      screen.getByText(
        '2 d’entre elles ont déjà été révisées (17 révisions enregistrées) : cette progression FSRS est perdue.',
      ),
    ).toBeTruthy()
  })

  it('omits the history line when there is genuinely none to lose', () => {
    renderConfirm([hit('a', 0), hit('b', 0)])
    expect(screen.queryByText(/révisions enregistrées/)).toBeNull()
    // The irreversibility is stated regardless.
    expect(screen.getByText('Cette action est irréversible.')).toBeTruthy()
  })

  it('counts the SELECTION, not the rows it happens to know about', () => {
    // A selection spans pages; only the rows the user has seen are in `hits`.
    // The count must still be the real one, and the history line stays
    // conservative rather than inventing figures for the unseen rows.
    renderConfirm([hit('a', 4)], vi.fn(), 40)
    expect(screen.getByText('Supprimer 40 cartes ?')).toBeTruthy()
    expect(screen.getByText(/1 d’entre elles a déjà été révisée \(4 révisions/)).toBeTruthy()
  })

  it('uses the singular for one card', () => {
    renderConfirm([hit('a', 0)])
    expect(screen.getByText('Supprimer 1 carte ?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Supprimer la carte' })).toBeTruthy()
  })

  it('does nothing until the destructive button is actually pressed', () => {
    const onConfirm = renderConfirm([hit('a', 0), hit('b', 0)])
    expect(onConfirm).not.toHaveBeenCalled()
    // Radix puts initial focus on Cancel; confirming is a deliberate move.
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer 2 cartes' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
