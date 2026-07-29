// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { QueueNewCards } from '@engram/shared'

/**
 * Plain anchor instead of the router's `Link`, so this file keeps asserting the
 * COPY on the component itself — no RouterProvider, no portal, no shell context.
 * Same stub as `not-found.test.tsx`. The view gained a link to Settings when the
 * study-pace control was built (T-049); without this, `useLinkProps` reaches for
 * a router that is deliberately not mounted here.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

import { LangProvider } from '@/lib/i18n'
import { EmptyQueueView } from './review-session'

/**
 * The regression this file exists for. The session used to branch on
 * `total === 0` alone and render "Rien à réviser — tout est à jour", which is a
 * LIE whenever the daily new-card budget is what emptied the queue: someone who
 * spends their 20 new cards on one subject and then opens a session filtered on
 * another subject holding only never-seen cards gets congratulated while cards
 * wait in silence. Same class of defect as congratulating a user for a failure.
 */

afterEach(cleanup)

/**
 * jsdom in this project ships no `localStorage` (see `landing-page.test.tsx`,
 * which installs the same shim). `LangProvider` reads `engram-lang` from it, so
 * a real store is what lets these tests pin the language deterministically
 * rather than depending on `navigator.language`.
 */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true })
})

const budget = (o: Partial<QueueNewCards> = {}): QueueNewCards => ({
  limit: 20,
  introduced: 0,
  remaining: 20,
  withheld: 0,
  ...o,
})

/** Render in a chosen language — the copy must exist and be right in both. */
function renderIn(lang: 'fr' | 'en', newCards: QueueNewCards | undefined) {
  localStorage.setItem('engram-lang', lang)
  return render(
    <LangProvider>
      <EmptyQueueView newCards={newCards} onExit={() => {}} />
    </LangProvider>,
  )
}

describe('empty because it is genuinely empty', () => {
  it('keeps the congratulation when nothing is held back', () => {
    renderIn('fr', budget({ withheld: 0 }))
    expect(screen.getByText('Rien à réviser — tout est à jour.')).toBeTruthy()
    expect(screen.queryByText(/gardée?s? pour demain/)).toBeNull()
  })

  it('keeps it when the budget is spent but nothing is waiting behind it', () => {
    renderIn('fr', budget({ introduced: 20, remaining: 0, withheld: 0 }))
    expect(screen.getByText('Rien à réviser — tout est à jour.')).toBeTruthy()
  })

  it('keeps it when the server sent no budget — never invents a count', () => {
    // Older serverless function mid-rollout: `newCards` is optional in the
    // contract, and silence is the only honest output.
    renderIn('fr', undefined)
    expect(screen.getByText('Rien à réviser — tout est à jour.')).toBeTruthy()
  })
})

describe('empty because the daily budget held cards back', () => {
  it('says how many are waiting instead of congratulating (FR, plural)', () => {
    renderIn('fr', budget({ limit: 20, introduced: 20, remaining: 0, withheld: 7 }))
    expect(screen.queryByText('Rien à réviser — tout est à jour.')).toBeNull()
    expect(screen.getByText('7 nouvelles cartes sont gardées pour demain.')).toBeTruthy()
    // The numbers that explain WHY, without claiming where they were spent.
    expect(screen.getByText('20/20 nouvelles cartes introduites aujourd’hui')).toBeTruthy()
    // Explanatory, not scolding, and it states the budget spans every subject —
    // the fact that makes a filtered session's empty queue understandable.
    expect(screen.getByText(/s’applique à toutes les matières/)).toBeTruthy()
  })

  it('uses the singular for exactly one held card (FR)', () => {
    renderIn('fr', budget({ limit: 5, introduced: 5, remaining: 0, withheld: 1 }))
    expect(screen.getByText('1 nouvelle carte est gardée pour demain.')).toBeTruthy()
  })

  it('says the same thing in English, with its own plural rules', () => {
    renderIn('en', budget({ limit: 20, introduced: 20, remaining: 0, withheld: 7 }))
    expect(screen.getByText('7 new cards are held back for tomorrow.')).toBeTruthy()
    expect(screen.getByText('20/20 new cards introduced today')).toBeTruthy()

    cleanup()
    renderIn('en', budget({ limit: 5, introduced: 5, remaining: 0, withheld: 1 }))
    expect(screen.getByText('1 new card is held back for tomorrow.')).toBeTruthy()
  })
})

describe('empty because new cards are paused (limit 0)', () => {
  it('phrases it as the choice it is, not as a limit that was hit', () => {
    renderIn('fr', budget({ limit: 0, introduced: 0, remaining: 0, withheld: 4 }))
    expect(screen.getByText('Les nouvelles cartes sont en pause.')).toBeTruthy()
    expect(screen.getByText('4 cartes jamais vues en attente · limite 0/jour')).toBeTruthy()
    // And it reminds the user that the pause never touches due cards.
    expect(screen.getByText(/cartes dues, elles, restent toujours proposées/)).toBeTruthy()
    // Never the "introduced today" wording — 0/0 would read as nonsense.
    expect(screen.queryByText(/introduites aujourd’hui/)).toBeNull()
  })

  it('pluralises the paused count and translates (EN)', () => {
    renderIn('en', budget({ limit: 0, remaining: 0, withheld: 1 }))
    expect(screen.getByText('New cards are paused.')).toBeTruthy()
    expect(screen.getByText('1 never-seen card waiting · limit 0/day')).toBeTruthy()
  })
})
