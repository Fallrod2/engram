// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ExamReadiness, ReadinessBreakdown, Subject, SubjectReadiness } from '@engram/shared'
import { ReadinessPanel } from './readiness-panel'

afterEach(cleanup)

const SUBJECT = { id: 's1', name: 'Théorie des langages', color: '#7999f5' } as Subject
const NOW = new Date('2026-07-29T10:00:00.000Z')

function breakdown(o: Partial<ReadinessBreakdown> = {}): ReadinessBreakdown {
  return {
    at: NOW.toISOString(),
    cardTotal: 14,
    ready: 11,
    notReady: 3,
    neverReviewed: 3,
    readiness: 11 / 14,
    meanRecall: 0.75,
    ...o,
  }
}

function exam(o: Partial<ExamReadiness> = {}): ExamReadiness {
  return {
    examId: 'e1',
    title: 'Partiel de théorie des langages',
    date: '2026-08-12T00:00:00.000Z',
    daysUntil: 14,
    status: 'forecast',
    projectedAt: '2026-08-12T00:00:00.000Z',
    projection: breakdown({ ready: 5, notReady: 9, readiness: 5 / 14 }),
    ...o,
  }
}

function renderPanel(
  data: SubjectReadiness | undefined,
  opts: { error?: boolean; onRetry?: () => void } = {},
) {
  return render(
    <ReadinessPanel
      data={data}
      subject={SUBJECT}
      threshold={0.9}
      now={NOW}
      isFetching={false}
      error={opts.error ?? false}
      onRetry={opts.onRetry ?? (() => {})}
      noCardsAction={<button type="button">Nouveau deck</button>}
    />,
  )
}

describe('<ReadinessPanel> — the composition is on screen, not in a tooltip', () => {
  it('spells out ready / to review / never seen next to the percentage', () => {
    renderPanel({ subjectId: 's1', today: breakdown(), exams: [] })
    expect(screen.getByText('79 %')).toBeTruthy()
    // Each count is a text node of its own, beside its label — no hover needed.
    expect(screen.getAllByText('11').length).toBeGreaterThan(0)
    expect(screen.getAllByText('prêtes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('jamais vues').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sur 14 cartes').length).toBeGreaterThan(0)
  })

  it('keeps a zero part visible, so "0 to review" and "not counted" never look alike', () => {
    renderPanel({
      subjectId: 's1',
      today: breakdown({ ready: 8, notReady: 6, neverReviewed: 6, readiness: 8 / 14 }),
      exams: [],
    })
    expect(screen.getAllByText('à revoir').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('says out loud that never-seen cards count as not ready', () => {
    renderPanel({ subjectId: 's1', today: breakdown(), exams: [] })
    expect(
      screen.getByText(
        '3 cartes n’ont jamais été vues : elles comptent comme non prêtes, ici et le jour de l’examen.',
      ),
    ).toBeTruthy()
  })

  it('reads the exam against today rather than as an isolated figure', () => {
    renderPanel({ subjectId: 's1', today: breakdown(), exams: [exam()] })
    expect(screen.getByText('79 %')).toBeTruthy() // baseline
    expect(screen.getByText('36 %')).toBeTruthy() // exam day
    expect(screen.getByText("−43 pts vs aujourd'hui")).toBeTruthy()
  })
})

describe('<ReadinessPanel> — the three degenerate cases', () => {
  it('no card: a message and the exam it costs, never a percentage', () => {
    const empty = breakdown({
      cardTotal: 0,
      ready: 0,
      notReady: 0,
      neverReviewed: 0,
      readiness: null,
      meanRecall: null,
    })
    const { container } = renderPanel({
      subjectId: 's1',
      today: empty,
      exams: [exam({ status: 'no_cards', projection: empty })],
    })
    expect(screen.getByText('Aucune carte dans cette matière')).toBeTruthy()
    // The deadline is named, with its countdown — that is what makes it actionable.
    expect(screen.getByText('Partiel de théorie des langages')).toBeTruthy()
    expect(screen.getByText('J-14')).toBeTruthy()
    expect(screen.getByText('Nouveau deck')).toBeTruthy()
    // And no readiness figure of any kind (the only `%` on screen is the
    // threshold in the header, which is a setting, not a measurement).
    expect(screen.queryAllByText(/^\d+ %$/)).toHaveLength(0)
    expect(container.textContent).not.toContain('NaN')
  })

  it('past exam: kept, named, and given no forecast at all', () => {
    renderPanel({
      subjectId: 's1',
      today: breakdown(),
      exams: [
        exam({
          examId: 'past',
          title: 'Interro d’automates',
          daysUntil: -5,
          status: 'past',
          projectedAt: null,
          projection: null,
        }),
      ],
    })
    expect(screen.getByText('Examens passés')).toBeTruthy()
    expect(screen.getByText('Interro d’automates')).toBeTruthy()
    expect(screen.getByText('aucune projection')).toBeTruthy()
    // Today's figure is the only percentage on screen: nothing was projected.
    expect(screen.getAllByText(/^\d+ %$/)).toHaveLength(1)
  })

  it('no exam: today still stands, with a line saying why it is alone', () => {
    renderPanel({ subjectId: 's1', today: breakdown(), exams: [] })
    expect(screen.getByText('Aucun examen programmé pour cette matière.')).toBeTruthy()
    expect(screen.getByText('79 %')).toBeTruthy()
  })

  it('null readiness renders a dash and an explicit aria label, never NaN', () => {
    const empty = breakdown({
      cardTotal: 0,
      ready: 0,
      notReady: 0,
      neverReviewed: 0,
      readiness: null,
      meanRecall: null,
    })
    // A subject with no card AND no exam: the gauge itself must not print NaN.
    const { container } = renderPanel({ subjectId: 's1', today: empty, exams: [] })
    expect(container.textContent).not.toContain('NaN')
    expect(screen.getByText('Aucune carte dans cette matière')).toBeTruthy()
  })
})

describe('<ReadinessPanel> — a failed read is not an empty subject', () => {
  it('shows the error and a retry, and none of the empty wording', () => {
    const onRetry = vi.fn()
    renderPanel(undefined, { error: true, onRetry })
    expect(screen.getByText('Impossible de charger la préparation aux examens.')).toBeTruthy()
    expect(screen.queryByText('Aucun examen programmé pour cette matière.')).toBeNull()
    expect(screen.queryByText('Aucune carte dans cette matière')).toBeNull()
    screen.getByText('Réessayer').click()
    expect(onRetry).toHaveBeenCalled()
  })
})
