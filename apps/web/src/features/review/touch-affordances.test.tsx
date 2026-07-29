// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { dictEn } from '@/lib/i18n/dict.en'
import { dictFr } from '@/lib/i18n/dict.fr'
import { ExitConfirm } from './exit-confirm'
import { IdleOverlay } from './idle-overlay'
import { RATINGS } from './labels'
import { RatingButton } from './rating-button'
import { SessionContextBar, CONTEXT_ACTION_ROW, CONTEXT_INFO_ROW } from './session-context-bar'
import { SessionExitButton } from './session-header'
import { ReviewCard } from './review-card'
import { SessionSummary } from './session-summary'

/**
 * T-029 — the session read with a finger.
 *
 * What the tester found on a phone: the only clue on a hidden card was an
 * `Espace` chip and a `SPACE REVEAL · 1-4 RATE · ESC EXIT` footer, the rating
 * grid still wore `1` `2` `3` `4`, and `Éditer` / `Passer` were a 12×12px glyph
 * each. Verdict: "usable in the métro only once you have guessed".
 *
 * jsdom runs no layout engine, so nothing here measures a pixel — the 44px
 * targets were measured in Chromium at 390×844, 320×568 and 834×1112 and are
 * recorded in the T-029 report. What this file pins is everything that decides
 * WHAT gets rendered for which pointer, because that is what a careless edit
 * puts back:
 *
 *   1. the pointer criterion is `(pointer: coarse)`, never a width;
 *   2. every keyboard chip disappears on touch and only on touch;
 *   3. every action carries a WORD on touch, not a letter;
 *   4. no accessible name promises a key a phone does not have;
 *   5. and — the one that must never regress — the keyboard is untouched:
 *      `aria-keyshortcuts` stays, and `use-review-session.ts` reads no media
 *      query at all (see its own suite).
 */

/**
 * Run `fn` with the browser reporting a coarse (touch) primary pointer.
 *
 * The stub answers `(pointer: coarse)` and NOTHING else, on purpose: any code
 * that tried to branch on a width media query would read `false` here and the
 * test would fail rather than quietly pass on a viewport assumption.
 */
function withTouchPointer(fn: () => void): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('pointer: coarse'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
  try {
    fn()
  } finally {
    vi.unstubAllGlobals()
  }
}

const BAR = {
  remaining: { new: 1, learning: 0, review: 2, relearning: 0 },
  difficulty: 6,
  canUndo: true,
  undoing: false,
  onEdit: () => {},
  onSkip: () => {},
  onUndo: () => {},
}

/** Classes of the node, as a list (jsdom loads no stylesheet). */
const classes = (el: Element) => el.className.split(/\s+/)

afterEach(cleanup)

describe('T-029 — the rating grid stops teaching keys it cannot be given', () => {
  const GOOD = RATINGS[2] // grade 3 · Bien

  function renderButton() {
    render(
      <RatingButton meta={GOOD} interval="7 j" disabled={false} flash={false} onRate={() => {}} />,
    )
    return screen.getByRole('button')
  }

  it('keeps the `3` chip on a keyboard', () => {
    const btn = renderButton()
    expect(screen.queryByText('3')).toBeTruthy()
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('3')
  })

  it('drops the chip on touch — and keeps the label, the interval and the shortcut', () => {
    withTouchPointer(() => {
      const btn = renderButton()
      // The chip is gone…
      expect(screen.queryByText('3')).toBeNull()
      // …the two things a thumb actually reads are not.
      expect(screen.getByText('Bien')).toBeTruthy()
      expect(screen.getByText('7 j')).toBeTruthy()
      // …and the key still works, so it is still declared to assistive tech.
      expect(btn.getAttribute('aria-keyshortcuts')).toBe('3')
      expect(btn.getAttribute('aria-label')).toBe('Bien — prochaine révision dans 7 j')
    })
  })
})

describe('T-029 — Éditer and Passer are words, on a target a thumb can hit', () => {
  it('hides its label under 640px on a keyboard (the 24px strip must hold at 320px)', () => {
    render(<SessionContextBar {...BAR} />)
    const skip = screen.getByRole('button', { name: 'Passer cette carte sans la noter (S)' })
    // `hidden sm:inline` — the aria-label is what carries the meaning there.
    expect(classes(skip.querySelector('span')!)).toContain('hidden')
  })

  it('shows the label unconditionally on touch — a lone glyph is what read as decoration', () => {
    withTouchPointer(() => {
      render(<SessionContextBar {...BAR} />)
      for (const [name, word] of [
        ['Annuler la dernière note', 'Annuler'],
        ['Éditer cette carte', 'Éditer'],
        ['Passer cette carte sans la noter', 'Passer'],
      ] as const) {
        const btn = screen.getByRole('button', { name })
        expect(btn.textContent).toBe(word)
        expect(classes(btn.querySelector('span')!)).not.toContain('hidden')
      }
    })
  })

  it('stops announcing a key the device does not have, and only then', () => {
    render(<SessionContextBar {...BAR} />)
    expect(screen.getByRole('button', { name: 'Éditer cette carte (E)' })).toBeTruthy()
    cleanup()
    withTouchPointer(() => {
      render(<SessionContextBar {...BAR} />)
      expect(screen.queryByRole('button', { name: 'Éditer cette carte (E)' })).toBeNull()
      const edit = screen.getByRole('button', { name: 'Éditer cette carte' })
      // The shortcut is still DECLARED — it still fires. Only the sentence read
      // out loud drops it, so the spoken name matches the visible label
      // (WCAG 2.5.3) instead of promising an `E` key.
      expect(edit.getAttribute('aria-keyshortcuts')).toBe('E')
    })
  })

  it('gives the three actions a 44px row of their own, and only on touch', () => {
    render(<SessionContextBar {...BAR} />)
    const keyboardRows = [...document.body.firstElementChild!.firstElementChild!.children].map(
      (r) => classes(r),
    )
    expect(keyboardRows).toHaveLength(1)
    expect(keyboardRows[0]).toContain(CONTEXT_INFO_ROW)
    cleanup()
    withTouchPointer(() => {
      render(<SessionContextBar {...BAR} />)
      const rows = [...document.body.firstElementChild!.firstElementChild!.children].map((r) =>
        classes(r),
      )
      expect(rows).toHaveLength(2)
      // The instrumentation strip keeps its 24px on BOTH pointer types — only
      // the action row is added, so the touch screen is the keyboard screen
      // plus one constant row, never a different layout.
      expect(rows[0]).toContain(CONTEXT_INFO_ROW)
      expect(rows[1]).toContain(CONTEXT_ACTION_ROW)
    })
  })

  it('keeps the three actions live and in the same order on touch', () => {
    const onEdit = vi.fn()
    const onSkip = vi.fn()
    const onUndo = vi.fn()
    withTouchPointer(() => {
      render(<SessionContextBar {...BAR} onEdit={onEdit} onSkip={onSkip} onUndo={onUndo} />)
      expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
        'Annuler la dernière note',
        'Éditer cette carte',
        'Passer cette carte sans la noter',
      ])
      for (const name of [
        'Annuler la dernière note',
        'Éditer cette carte',
        'Passer cette carte sans la noter',
      ]) {
        fireEvent.click(screen.getByRole('button', { name }))
      }
    })
    expect([onUndo.mock.calls.length, onEdit.mock.calls.length, onSkip.mock.calls.length]).toEqual([
      1, 1, 1,
    ])
  })

  it('still refuses all three while an undo is in flight, on touch too (T-010)', () => {
    const onSkip = vi.fn()
    withTouchPointer(() => {
      render(<SessionContextBar {...BAR} undoing onSkip={onSkip} />)
      const skip = screen.getByRole('button', { name: 'Passer cette carte sans la noter' })
      expect((skip as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(skip)
    })
    expect(onSkip).not.toHaveBeenCalled()
  })
})

describe('T-029 — the way out, the pause and the summary follow the pointer', () => {
  it('names the exit with its key on a keyboard and without it on touch', () => {
    render(<SessionExitButton onExit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Quitter la session (Échap)' })).toBeTruthy()
    cleanup()
    withTouchPointer(() => {
      render(<SessionExitButton onExit={() => {}} />)
      const btn = screen.getByRole('button', { name: 'Quitter la session' })
      // 32px is a fine mouse target and a poor thumb one; the 48px header
      // absorbs the 44px square without moving anything else.
      expect(classes(btn)).toContain('size-11')
      expect(btn.getAttribute('aria-keyshortcuts')).toBe('Escape')
    })
  })

  it('tells a finger how to resume, instead of naming a key and a click', () => {
    render(<IdleOverlay onResume={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe(
      'Session en pause — appuie sur une touche ou clique pour reprendre',
    )
    cleanup()
    withTouchPointer(() => {
      render(<IdleOverlay onResume={() => {}} />)
      expect(screen.getByRole('status').textContent).toBe(
        'Session en pause — touche l’écran pour reprendre',
      )
    })
  })

  it('drops the Échap / Q chips of the exit dialog and grows its buttons', () => {
    render(<ExitConfirm onResume={() => {}} onQuit={() => {}} />)
    expect(screen.getByRole('button', { name: /^Reprendre/ }).textContent).toContain('Échap')
    cleanup()
    withTouchPointer(() => {
      render(<ExitConfirm onResume={() => {}} onQuit={() => {}} />)
      const resume = screen.getByRole('button', { name: 'Reprendre' })
      const quit = screen.getByRole('button', { name: 'Quitter' })
      expect(resume.textContent).toBe('Reprendre')
      expect(quit.textContent).toBe('Quitter')
      // With no key to press, a tap is the ONLY way out of this dialog.
      expect(classes(resume)).toContain('h-11')
      expect(classes(quit)).toContain('h-11')
    })
  })

  it('grows the summary buttons and stops announcing (U) there too', () => {
    const summary = {
      viewed: 3,
      byGrade: { 1: 1, 2: 0, 3: 2, 4: 0 },
      totalMs: 42_000,
      avgMs: 14_000,
      successRate: 67,
    } as const
    withTouchPointer(() => {
      render(
        <SessionSummary
          summary={summary}
          canReviewAgain
          canUndo
          undoing={false}
          onExit={() => {}}
          onReviewAgain={() => {}}
          onUndo={() => {}}
        />,
      )
      for (const name of [
        'Retour au tableau de bord',
        'Réviser encore',
        'Annuler la dernière note',
      ])
        expect(classes(screen.getByRole('button', { name }))).toContain('h-11')
      expect(screen.queryByRole('button', { name: 'Annuler la dernière note (U)' })).toBeNull()
    })
  })
})

describe('T-029 — one reveal command, named once', () => {
  const CARD = {
    front: 'question',
    back: 'réponse',
    qcm: null,
    selectedChoice: null,
    revealed: false,
    reduce: true,
    // The reveal affordance is a naming question, not an animation one — any of
    // the three modes would do here. The default is the honest one to pin.
    animation: 'unfold',
    onSelect: () => {},
  } as const

  it('keeps the card itself as the named reveal button on a keyboard', () => {
    const onReveal = vi.fn()
    const { container } = render(<ReviewCard {...CARD} onReveal={onReveal} />)
    // There, the card IS the only reveal affordance: the thing beside it is a
    // line of text, not a control.
    const card = screen.getByRole('button', { name: 'Révéler la réponse' })
    expect(card.tagName).toBe('ARTICLE')
    fireEvent.click(container.querySelector('article')!)
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('leaves the naming to the explicit button on touch, and still reveals on tap', () => {
    const onReveal = vi.fn()
    withTouchPointer(() => {
      const { container } = render(<ReviewCard {...CARD} onReveal={onReveal} />)
      const card = container.querySelector('article')!
      // `RatingBar` renders a real "Révéler la réponse" button on touch; the
      // card must not answer to that name a second time.
      expect(screen.queryByRole('button')).toBeNull()
      expect(card.getAttribute('aria-label')).toBeNull()
      // The gesture the tester DID find on his own keeps working.
      fireEvent.click(card)
    })
    expect(onReveal).toHaveBeenCalledTimes(1)
  })
})

describe('T-029 — the shortcut suffix is composed, in both languages', () => {
  // The alternative was a touch copy and a keyboard copy of each sentence. Two
  // copies drift; one template plus one label cannot. Both dictionaries must
  // therefore carry the template AND the bare sentence — a FR-only wrapper
  // would silently print "{label} ({key})" in English.
  it('keeps a {label} ({key}) template on both sides', () => {
    for (const dict of [dictFr, dictEn]) {
      expect(dict.session.withShortcut).toContain('{label}')
      expect(dict.session.withShortcut).toContain('{key}')
    }
  })

  it('leaves no bare shortcut letter baked into the sentences themselves', () => {
    for (const dict of [dictFr, dictEn]) {
      for (const key of ['skipAria', 'editAria', 'undoAria', 'exitAria'] as const) {
        expect(dict.session[key], `${key}`).not.toMatch(/\([A-ZÉ][a-z]*\)\s*$/)
      }
    }
  })
})
