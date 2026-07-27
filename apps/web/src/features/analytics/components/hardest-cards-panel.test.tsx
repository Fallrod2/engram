// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { HardestCardsResponse, Subject } from '@engram/shared'
import { HardestCardsPanel } from './hardest-cards-panel'

afterEach(cleanup)

const SUBJECTS = [
  { id: 's1', name: 'Théorie des langages', color: '#3b82f6' },
  { id: 's2', name: 'Anglais', color: '#22c55e' },
] as Subject[]

function response(cards: HardestCardsResponse['cards']): HardestCardsResponse {
  return { minReps: 3, limit: 5, cards }
}

const card = (o: Partial<HardestCardsResponse['cards'][number]>) => ({
  cardId: 'c1',
  deckId: 'd1',
  subjectId: 's1',
  front: 'Question',
  difficulty: 5,
  lapses: 0,
  reps: 4,
  ...o,
})

function renderPanel(data: HardestCardsResponse | undefined) {
  return render(
    <HardestCardsPanel
      data={data}
      subjects={SUBJECTS}
      isFetching={false}
      error={false}
      onRetry={() => {}}
    />,
  )
}

describe('<HardestCardsPanel>', () => {
  it('groups the cards by subject, in server (hardest-first) order', () => {
    const { container } = renderPanel(
      response([
        card({ cardId: 'a', subjectId: 's2', front: 'Irregular verbs', difficulty: 9 }),
        card({ cardId: 'b', subjectId: 's1', front: 'Pumping lemma', difficulty: 7 }),
        card({ cardId: 'c', subjectId: 's1', front: 'Chomsky hierarchy', difficulty: 6 }),
      ]),
    )
    // Two groups, the subject holding the hardest card first.
    // `:not([aria-hidden])` skips the SubjectDot, which is a decorative span.
    const groupNames = Array.from(
      container.querySelectorAll('ul > li > div > span:not([aria-hidden])'),
    ).map((el) => el.textContent)
    expect(groupNames).toEqual(['Anglais', 'Théorie des langages'])
    // The 3 cards land in the right group (1 + 2), keeping their order.
    const groups = container.querySelectorAll('ul > li > ul')
    expect(groups[0]?.querySelectorAll('li').length).toBe(1)
    expect(groups[1]?.querySelectorAll('li').length).toBe(2)
    expect(groups[1]?.textContent).toContain('Pumping lemma')
    expect(groups[1]?.textContent).toContain('Chomsky hierarchy')
  })

  it('renders the difficulty with exactly one decimal', () => {
    renderPanel(response([card({ difficulty: 8 }), card({ cardId: 'c2', difficulty: 6.28 })]))
    expect(screen.getByText('8.0')).toBeTruthy()
    expect(screen.getByText('6.3')).toBeTruthy()
    expect(screen.getByLabelText('Difficulté de cette carte : 8.0 sur 10')).toBeTruthy()
  })

  it('flattens the Markdown excerpt to a single truncated plain-text line', () => {
    const { container } = renderPanel(
      response([card({ front: '# Titre\n\n**gras** et `code`\n- item' })]),
    )
    const excerpt = container.querySelector('ul > li > ul > li > span') as HTMLElement
    expect(excerpt.textContent).toBe('Titre gras et code item')
    expect(excerpt.textContent).not.toContain('#')
    expect(excerpt.className).toContain('truncate') // one line, cut with an ellipsis
  })

  it('shows a "not enough reviews" empty state quoting minReps, not "no data"', () => {
    renderPanel(response([]))
    expect(screen.getByText('Pas encore assez de révisions pour classer tes cartes.')).toBeTruthy()
    expect(screen.getByText('Une carte entre au classement à partir de 3 reviews.')).toBeTruthy()
  })

  it('drops cards whose subject is unknown client-side', () => {
    renderPanel(response([card({ subjectId: 'gone' })]))
    // Nothing renderable left → the same honest empty state.
    expect(screen.getByText('Pas encore assez de révisions pour classer tes cartes.')).toBeTruthy()
  })
})
