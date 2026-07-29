// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { Deck, Subject } from '@engram/shared'
import { GenerationLaunchPanel, type DeckGroup } from './generation-launch-panel'

/**
 * "No provider configured" is now said BEFORE the click (T-031).
 *
 * The bug this covers: the only signal used to be the 503 that came back AFTER
 * the launch, by which point the visitor had already chosen a type and created a
 * target deck for nothing. The server keeps its 503 — that is the real guard —
 * so what is asserted here is only that the panel refuses to offer an action it
 * knows will fail, and says why.
 */

afterEach(cleanup)

const subject: Subject = {
  id: 's1',
  name: 'Théorie des langages',
  color: '#6366f1',
  icon: 'book-open',
  position: 0,
  archived: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}
const deck: Deck = {
  id: 'd1',
  subjectId: 's1',
  name: 'Automates',
  description: null,
  position: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}
const GROUPS: DeckGroup[] = [{ subject, decks: [deck] }]

function panel(over: Partial<Parameters<typeof GenerationLaunchPanel>[0]> = {}) {
  return (
    <GenerationLaunchPanel
      kind="cards"
      onKindChange={vi.fn()}
      deckId="d1"
      onDeckChange={vi.fn()}
      deckGroups={GROUPS}
      contentEmpty={false}
      onLaunch={vi.fn()}
      pending={false}
      {...over}
    />
  )
}

const generateButton = () => screen.getByRole('button', { name: /Générer|Generate/ })

describe('<GenerationLaunchPanel> and the missing provider', () => {
  it('offers the launch when everything is in place', () => {
    render(panel())
    expect(generateButton()).toHaveProperty('disabled', false)
  })

  it('refuses the launch when no provider can run', () => {
    render(panel({ providerUnavailable: true }))
    expect(generateButton()).toHaveProperty('disabled', true)
  })

  it('says WHY, rather than greying the button out in silence', () => {
    render(panel({ providerUnavailable: true }))
    expect(screen.getByText(/Aucun provider IA configuré|No AI provider configured/)).toBeTruthy()
  })

  it('names the provider problem first, over the other blockers', () => {
    // A missing deck or an empty note is irrelevant while nothing can generate:
    // fixing them would not unblock the button, so leading with them would send
    // the visitor down the wrong path.
    render(panel({ providerUnavailable: true, contentEmpty: true, deckId: undefined }))
    expect(screen.getByText(/Aucun provider IA configuré|No AI provider configured/)).toBeTruthy()
    expect(screen.queryByText(/texte exploitable|usable text/)).toBeNull()
  })

  it('still blocks on the pre-existing reasons when a provider IS available', () => {
    cleanup()
    render(panel({ deckId: undefined }))
    expect(generateButton()).toHaveProperty('disabled', true)
    cleanup()
    render(panel({ contentEmpty: true }))
    expect(generateButton()).toHaveProperty('disabled', true)
  })
})
