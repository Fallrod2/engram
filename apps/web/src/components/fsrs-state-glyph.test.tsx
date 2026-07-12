// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { FsrsCardState, FsrsState } from '@engram/shared'
import { FsrsStateGlyph } from './fsrs-state-glyph'
import { TooltipProvider } from '@/components/ui/tooltip'

afterEach(cleanup)

function fsrs(state: FsrsState): FsrsCardState {
  return {
    due: '2026-07-12T10:00:00.000Z',
    stability: 1.5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state,
    lastReview: null,
  }
}

function renderGlyph(state: FsrsState) {
  return render(
    <TooltipProvider>
      <FsrsStateGlyph fsrs={fsrs(state)} />
    </TooltipProvider>,
  )
}

describe('<FsrsStateGlyph> monochrome glyph (design §6.2)', () => {
  const cases: Array<{ state: FsrsState; label: string; klass: string }> = [
    { state: 0, label: 'Nouvelle', klass: 'border-border-strong' },
    { state: 1, label: 'Apprentissage', klass: 'bg-info/60' },
    { state: 2, label: 'Révision', klass: 'bg-success' },
    { state: 3, label: 'Réapprentissage', klass: 'bg-warning' },
  ]

  for (const { state, label, klass } of cases) {
    it(`renders state ${state} as "${label}" with ${klass}`, () => {
      renderGlyph(state)
      const glyph = screen.getByRole('img')
      expect(glyph.getAttribute('aria-label')).toBe(label)
      expect(glyph.className).toContain(klass)
      // Always an 8px rounded square regardless of state.
      expect(glyph.className).toContain('size-2')
    })
  }
})
