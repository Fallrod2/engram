// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// Plain anchors: which router the CTA uses is not what is under test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

import { dictFr } from '@/lib/i18n/dict.fr'
import { dictEn } from '@/lib/i18n/dict.en'
import { SearchEmpty } from './search-empty'

afterEach(cleanup)

function renderEmpty(
  kind: 'idle' | 'noResults' | 'noCards',
  opts: { corpusSize?: number; filtersActive?: boolean; onReset?: () => void } = {},
) {
  return render(
    <SearchEmpty
      kind={kind}
      corpusSize={opts.corpusSize ?? 120}
      filtersActive={opts.filtersActive ?? false}
      onResetFilters={opts.onReset ?? (() => {})}
      onQuickFilter={() => {}}
    />,
  )
}

/**
 * Three states, three sentences, and the one that matters most is the third:
 * telling someone who has never created a card that their SEARCH found nothing
 * blames them for an emptiness the query had nothing to do with.
 */
describe('<SearchEmpty>', () => {
  it('invites, and says how much there is to search, before anything is typed', () => {
    renderEmpty('idle', { corpusSize: 120 })
    expect(screen.getByText('Cherche dans toutes tes cartes')).toBeTruthy()
    expect(screen.getByText('120 cartes indexées · recto et verso')).toBeTruthy()
    // Not a dead end: two real starting points.
    expect(screen.getByRole('button', { name: 'Cartes en retard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cartes jamais vues' })).toBeTruthy()
  })

  it('says "no card matches" only when a real query came back empty', () => {
    renderEmpty('noResults')
    expect(screen.getByText('Aucune carte ne correspond')).toBeTruthy()
    expect(screen.getByText('Essaie moins de mots, ou retire un filtre.')).toBeTruthy()
  })

  it('offers to drop the filters — but only when filters are what narrowed it', () => {
    const onReset = vi.fn()
    const { unmount } = renderEmpty('noResults', { filtersActive: true, onReset })
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect(onReset).toHaveBeenCalledOnce()
    unmount()

    renderEmpty('noResults', { filtersActive: false })
    expect(screen.queryByRole('button', { name: 'Réinitialiser les filtres' })).toBeNull()
  })

  it('never says "no results" to an account that has no cards at all', () => {
    renderEmpty('noCards', { corpusSize: 0 })
    expect(screen.getByText('Tu n’as pas encore de carte')).toBeTruthy()
    expect(screen.queryByText('Aucune carte ne correspond')).toBeNull()
    expect(screen.queryByText('Essaie moins de mots, ou retire un filtre.')).toBeNull()
    // And it points somewhere useful instead of at the search box.
    expect(screen.getByRole('link', { name: 'Voir mes matières' }).getAttribute('href')).toBe(
      '/subjects',
    )
  })

  it('keeps the three titles distinct in BOTH languages — never one reused', () => {
    for (const dict of [dictFr, dictEn]) {
      const titles = [
        dict.search.empty.idleTitle,
        dict.search.empty.noResultsTitle,
        dict.search.empty.noCardsTitle,
      ]
      expect(new Set(titles).size).toBe(3)
    }
  })
})
