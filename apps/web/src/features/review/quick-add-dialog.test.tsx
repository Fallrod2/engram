// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Card, Deck, Subject } from '@engram/shared'

/**
 * T-032 — the quick-add dialog, and above all what it must NOT do to the session
 * behind it.
 *
 * Everything below is asserted through the API the app really uses: the POST
 * payload for "which deck did it write to", the session hook's own state for
 * "did the session move", and real Radix surfaces for the focus/keyboard rules —
 * no component is stubbed out to make a claim easier to prove.
 */

const apiPost = vi.fn()
const apiGet = vi.fn()
const postReview = vi.fn()
const fetchReviewQueue = vi.fn()
const fetchCardPreview = vi.fn()
const toastError = vi.fn()
// Stable across renders, so "the session left the screen" is observable: leaving
// only ever shows up as a navigation.
const navigate = vi.fn()
const historyBack = vi.fn()
/** Every call the hook makes on the per-card clock, in order. */
const timerCalls: string[] = []

// Only the preference is stubbed. `<ReviewSession>` renders `AnimatePresence`
// and `motion.div`, so the module has to stay real underneath.
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => false,
}))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: (...args: unknown[]) => toastError(...args) }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back: historyBack, canGoBack: () => false } }),
}))
vi.mock('./session-timer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-timer')>()
  return {
    ...actual,
    createCardTimer: (machinePaused: boolean) => {
      const inner = actual.createCardTimer(machinePaused)
      return {
        pause: () => {
          timerCalls.push('pause')
          inner.pause()
        },
        pauseIdle: () => {
          timerCalls.push('pauseIdle')
          inner.pauseIdle()
        },
        resume: () => {
          timerCalls.push('resume')
          inner.resume()
        },
        read: () => inner.read(),
      }
    },
  }
})
// The full-screen session flags itself on the app shell. Stubbed rather than
// wrapped in a real `<ShellProvider>`: that provider owns the command palette,
// the g-chords and the sidebar, none of which this file has anything to say
// about, and it would drag the whole shell into a review-screen test.
vi.mock('@/components/shell/shell-context', () => ({
  useShell: () => ({ setSessionActive: () => {} }),
}))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  qs: (params: Record<string, unknown>) =>
    `?${Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('&')}`,
  postReview: (...args: unknown[]) => postReview(...args),
  postUndoReview: vi.fn(),
  fetchReviewQueue: (...args: unknown[]) => fetchReviewQueue(...args),
  fetchCardPreview: (...args: unknown[]) => fetchCardPreview(...args),
  updateCard: vi.fn(),
}))

import { TooltipProvider } from '@/components/ui/tooltip'
import { QuickAddDialog } from './quick-add-dialog'
import { ReviewSession } from './review-session'
import { useReviewSession } from './use-review-session'

/* ─────────────────────────────── fixtures ──────────────────────────────── */

const SUBJECTS: Subject[] = [
  {
    id: 'sub-langs',
    name: 'Théorie des langages',
    color: 'indigo',
    icon: 'book',
    archived: false,
    position: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'sub-old',
    name: 'Archi (archivée)',
    color: 'amber',
    icon: 'book',
    archived: true,
    position: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
]

const DECKS: Deck[] = [
  {
    id: 'deck-automata',
    subjectId: 'sub-langs',
    name: 'Automates finis',
    description: null,
    position: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'deck-grammars',
    subjectId: 'sub-langs',
    name: 'Grammaires',
    description: null,
    position: 1,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 'deck-retired',
    subjectId: 'sub-old',
    name: 'Pipeline',
    description: null,
    position: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
]

function makeCard(id: string, deckId = 'deck-grammars'): Card {
  return {
    id,
    deckId,
    front: `front ${id}`,
    back: `back ${id}`,
    fsrs: {
      due: '2026-07-12T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReview: null,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

/** `api.get` routed by path, so the two list queries can fail independently. */
function routeGet(opts: { subjects?: 'ok' | 'fail'; decks?: 'ok' | 'fail' } = {}) {
  apiGet.mockImplementation((path: string) => {
    if (path.startsWith('/subjects')) {
      return opts.subjects === 'fail'
        ? Promise.reject(new Error('subjects down'))
        : Promise.resolve(SUBJECTS)
    }
    if (path.startsWith('/decks')) {
      return opts.decks === 'fail'
        ? Promise.reject(new Error('decks down'))
        : Promise.resolve(DECKS)
    }
    return Promise.resolve([])
  })
}

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrap(ui: ReactNode) {
  return render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>)
}

/** The dialog on its own, opened, with the deck lists resolved. */
async function openDialog(props: Partial<Parameters<typeof QuickAddDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  wrap(<QuickAddDialog open onOpenChange={onOpenChange} currentDeckId="deck-grammars" {...props} />)
  await screen.findByRole('dialog')
  return { onOpenChange }
}

const front = () => screen.getByLabelText('Recto') as HTMLTextAreaElement
const back = () => screen.getByLabelText('Verso') as HTMLTextAreaElement

function type(el: HTMLTextAreaElement, value: string) {
  fireEvent.change(el, { target: { value } })
}

/**
 * What jsdom does not ship and Radix's `Select` calls the moment its list opens.
 * Stubs, not behaviour: the assertions below are about which options exist and
 * which one the POST ends up carrying, never about scrolling or pointer capture.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as (id: number) => boolean
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  apiGet.mockReset()
  apiPost.mockReset()
  postReview.mockReset()
  fetchReviewQueue.mockReset()
  fetchCardPreview.mockReset()
  toastError.mockReset()
  navigate.mockReset()
  historyBack.mockReset()
  timerCalls.length = 0
  routeGet()
  apiPost.mockResolvedValue(makeCard('created-1'))
  fetchReviewQueue.mockResolvedValue({
    now: '2026-07-12T10:00:00.000Z',
    total: 2,
    cards: [makeCard('c1', 'deck-grammars'), makeCard('c2', 'deck-automata')],
  })
  fetchCardPreview.mockResolvedValue({
    now: '2026-07-12T10:00:00.000Z',
    again: { due: '', stability: 1, difficulty: 5, scheduledDays: 1, state: 1 },
    hard: { due: '', stability: 1, difficulty: 5, scheduledDays: 1, state: 1 },
    good: { due: '', stability: 1, difficulty: 5, scheduledDays: 1, state: 1 },
    easy: { due: '', stability: 1, difficulty: 5, scheduledDays: 1, state: 1 },
  })
  postReview.mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* ───────────────────────── the dialog on its own ───────────────────────── */

describe('<QuickAddDialog> — the deck is pre-chosen on the card being revised', () => {
  it('shows the current card’s deck in the picker and writes to it', async () => {
    await openDialog()

    // The trigger names the deck rather than the placeholder: the pre-selection
    // has to be READABLE, otherwise "modifiable" is the only thing it offers.
    const trigger = await screen.findByRole('combobox')
    await waitFor(() => expect(trigger.textContent).toContain('Grammaires'))

    type(front(), 'Lemme de pompage')
    type(back(), 'Tout langage régulier admet une longueur de pompage.')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0]?.[0]).toBe('/cards')
    expect(apiPost.mock.calls[0]?.[1]).toEqual({
      deckId: 'deck-grammars',
      front: 'Lemme de pompage',
      back: 'Tout langage régulier admet une longueur de pompage.',
    })
  })

  it('offers the other decks, and lists an archived subject’s deck as unusable', async () => {
    await openDialog()
    fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'Enter' })
    const listbox = await screen.findByRole('listbox')

    const usable = within(listbox).getByRole('option', { name: 'Automates finis' })
    expect(usable.getAttribute('aria-disabled')).not.toBe('true')
    // The server answers 409 under an archived subject: shown, never offered.
    const retired = within(listbox).getByRole('option', { name: 'Pipeline' })
    expect(retired.getAttribute('aria-disabled')).toBe('true')
  })

  it('writes to the deck the user picked instead, not to the pre-selection', async () => {
    await openDialog()
    fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'Enter' })
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByRole('option', { name: 'Automates finis' }))

    type(front(), 'Déterminisation')
    type(back(), 'Construction par sous-ensembles.')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0]?.[1]).toMatchObject({ deckId: 'deck-automata' })
  })

  it('keeps typing possible when the deck lists fail, and says which deck it will use', async () => {
    routeGet({ decks: 'fail' })
    await openDialog()

    await screen.findByText(
      'Impossible de charger la liste des decks — la carte ira dans le deck de la carte affichée.',
    )
    // No dead control left behind: a picker that cannot be opened and shows no
    // deck name explains nothing.
    expect(screen.queryByRole('combobox')).toBeNull()

    type(front(), 'Recto')
    type(back(), 'Verso')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(apiPost.mock.calls[0]?.[1]).toMatchObject({ deckId: 'deck-grammars' })
  })

  it('refuses to submit when there is no deck at all to write to', async () => {
    routeGet({ decks: 'fail' })
    await openDialog({ currentDeckId: null })

    await screen.findByText('Impossible de charger la liste des decks.')
    type(front(), 'Recto')
    type(back(), 'Verso')
    const add = screen.getByRole('button', { name: /^Ajouter/ }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(add)
    expect(apiPost).not.toHaveBeenCalled()
  })
})

describe('<QuickAddDialog> — one card, then the next', () => {
  it('after "Ajouter", clears both fields, KEEPS the deck and refocuses the recto', async () => {
    await openDialog()
    type(front(), 'Première notion')
    type(back(), 'Sa réponse')
    // The caret really is in the VERSO when the card is submitted — that is
    // where the user finished typing. Without this the recto would still hold
    // focus by default and "refocuses the recto" would assert nothing.
    back().focus()
    expect(document.activeElement).toBe(back())
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))

    // The dialog does NOT close: the real case is three missing notions in a row.
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(front().value).toBe(''))
    expect(back().value).toBe('')
    expect(document.activeElement).toBe(front())
    expect(screen.getByRole('combobox').textContent).toContain('Grammaires')

    // ...and the second card really goes to the same deck.
    type(front(), 'Deuxième notion')
    type(back(), 'Son autre réponse')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2))
    expect(apiPost.mock.calls[1]?.[1]).toMatchObject({
      deckId: 'deck-grammars',
      front: 'Deuxième notion',
    })
  })

  it('counts the salvo out loud', async () => {
    await openDialog()
    for (const n of ['une', 'deux']) {
      type(front(), `notion ${n}`)
      type(back(), `réponse ${n}`)
      fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
      await waitFor(() => expect(front().value).toBe(''))
    }
    expect(screen.getByText('+2 ajoutées')).toBeTruthy()
  })

  it('refuses an empty card and writes nothing', async () => {
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(screen.getAllByText('Ce champ est requis.')).toHaveLength(2))
    expect(apiPost).not.toHaveBeenCalled()
  })
})

describe('<QuickAddDialog> — leaving never eats what was typed', () => {
  it('closes straight away when nothing has been typed', async () => {
    const { onOpenChange } = await openDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks before dropping a draft, on Échap', async () => {
    const { onOpenChange } = await openDialog()
    type(front(), 'une notion à moitié écrite')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Abandonner cette carte ?')).toBeTruthy()
    // Nothing has closed yet — the question is the whole point.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    fireEvent.click(within(confirm).getByRole('button', { name: 'Abandonner' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('cancelling the confirm puts the user back in front of their text', async () => {
    const { onOpenChange } = await openDialog()
    type(front(), 'une notion à moitié écrite')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Annuler' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(front().value).toBe('une notion à moitié écrite')
  })

  it('asks on the "Terminé" button too — every way out goes through one gate', async () => {
    const { onOpenChange } = await openDialog()
    type(back(), 'seulement le verso, mais c’est déjà du travail')
    fireEvent.click(screen.getByRole('button', { name: 'Terminé' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('leaves without asking once the draft has been submitted', async () => {
    const { onOpenChange } = await openDialog()
    type(front(), 'Recto')
    type(back(), 'Verso')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(front().value).toBe(''))

    fireEvent.click(screen.getByRole('button', { name: 'Terminé' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('<QuickAddDialog> — announced, and it announces what the card becomes', () => {
  it('is a modal dialog with a name and an explanation of where the card goes', async () => {
    await openDialog()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Nouvelle carte')).toBeTruthy()
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    // The one thing a user cannot deduce: the card does NOT join the queue in
    // progress. Said before typing, not discovered afterwards.
    expect(dialog.textContent).toContain('pas par la session en cours')
  })
})

/* ───────────── the dialog over a live session (the real wiring) ─────────── */

/**
 * The session and its dialog, wired exactly as `review-session.tsx` wires them.
 * Rendered rather than mocked because the claim under test — "the session's keys
 * do not reach the session while the dialog is open" — is a claim about the REAL
 * Radix surface being in the document: `use-review-session`'s key router bails
 * out on `isModalSurfaceOpen()`, which reads `[role=dialog][data-state=open]`.
 */
function SessionHarness({ onApi }: { onApi: (api: ReturnType<typeof useReviewSession>) => void }) {
  const api = useReviewSession({})
  onApi(api)
  return (
    <>
      <QuickAddDialog
        open={api.quickAdding}
        onOpenChange={(next) => {
          if (!next) api.closeQuickAdd()
        }}
        currentDeckId={api.current?.deckId ?? null}
      />
      <p data-testid="phase">{api.phase}</p>
      <p data-testid="index">{api.progress.done}</p>
    </>
  )
}

async function renderSession() {
  let api!: ReturnType<typeof useReviewSession>
  wrap(<SessionHarness onApi={(a) => (api = a)} />)
  await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ASKING'))
  return { get: () => api }
}

describe('quick add inside a live session', () => {
  it('opens on N, and the session underneath does not move', async () => {
    const { get } = await renderSession()
    expect(get().quickAdding).toBe(false)

    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')

    expect(get().quickAdding).toBe(true)
    expect(get().phase).toBe('ASKING')
    expect(get().progress.done).toBe(0)
    expect(get().current?.id).toBe('c1')
  })

  it('opens on N from REVEALED and leaves the answer on screen', async () => {
    const { get } = await renderSession()
    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(() => expect(get().phase).toBe('REVEALED'))

    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')
    expect(get().phase).toBe('REVEALED')
    expect(get().revealed).toBe(true)
  })

  it('pre-selects the deck of the card ON SCREEN, not the first deck of the list', async () => {
    fetchReviewQueue.mockResolvedValue({
      now: '2026-07-12T10:00:00.000Z',
      total: 1,
      // `deck-automata` sorts FIRST in the picker; the card is in the other one,
      // so a naive "take the first deck" would pass every other test but this.
      cards: [makeCard('c9', 'deck-grammars')],
    })
    await renderSession()
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Grammaires'))
  })

  it('freezes the card clock while the dialog is open and restarts it on close', async () => {
    const { get } = await renderSession()
    timerCalls.length = 0

    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')
    // Time spent writing a card is not time spent recalling the one on screen.
    expect(timerCalls.at(-1)).toBe('pause')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(get().quickAdding).toBe(false))
    expect(timerCalls.at(-1)).toBe('resume')
  })

  it('makes the session keys inert while it is open — no reveal, no rating, no skip', async () => {
    const { get } = await renderSession()
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')

    for (const key of [' ', 'Enter', '1', '2', '3', '4', 's', 'e', 'u']) {
      fireEvent.keyDown(window, { key })
    }

    expect(get().phase).toBe('ASKING')
    expect(get().revealed).toBe(false)
    expect(get().progress.done).toBe(0)
    expect(get().current?.id).toBe('c1')
    expect(get().editing).toBe(false)
    expect(postReview).not.toHaveBeenCalled()
  })

  it('typing a "3" into the recto writes text, it does not rate the card behind', async () => {
    const { get } = await renderSession()
    fireEvent.keyDown(window, { key: ' ' })
    await waitFor(() => expect(get().phase).toBe('REVEALED'))
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')

    fireEvent.keyDown(front(), { key: '3' })
    type(front(), '3-SAT')

    expect(front().value).toBe('3-SAT')
    expect(postReview).not.toHaveBeenCalled()
    expect(get().phase).toBe('REVEALED')
  })

  it('Échap closes the dialog and does not exit the session', async () => {
    const { get } = await renderSession()
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(get().quickAdding).toBe(false))
    // The lesson of the /search Escape leak: one key, one owner. The session
    // must not read the same keystroke that closed the dialog — with no rating
    // yet, its Escape does not even ask, it walks straight out.
    expect(get().confirmingExit).toBe(false)
    expect(get().phase).toBe('ASKING')
    expect(navigate).not.toHaveBeenCalled()
    expect(historyBack).not.toHaveBeenCalled()
  })

  it('the card it writes never joins the lot in progress', async () => {
    const { get } = await renderSession()
    const before = get().progress.total
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')

    type(front(), 'La notion qui manquait')
    type(back(), 'Sa réponse')
    fireEvent.click(screen.getByRole('button', { name: /^Ajouter/ }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))

    expect(get().progress.total).toBe(before)
    expect(get().current?.id).toBe('c1')
    expect(get().remaining.new).toBe(2)
  })
})

/* ─────────────────────── the screen, wired for real ─────────────────────── */

/**
 * `<ReviewSession>` itself, not a harness that copies its wiring. Everything
 * above proves the pieces; this proves they are PLUGGED IN — that the screen
 * really mounts the dialog on `api.quickAdding`, really hands it the current
 * card's deck, and really gives the context strip's button `api.openQuickAdd`.
 * Each of those is one prop, and one prop is exactly what gets forgotten.
 */
async function renderScreen() {
  wrap(
    <TooltipProvider>
      <ReviewSession scope={{}} />
    </TooltipProvider>,
  )
  // The session is up once the first card's context strip is on screen.
  await screen.findByRole('button', { name: 'Passer cette carte sans la noter (S)' })
}

describe('<ReviewSession> — the quick add is reachable from the screen itself', () => {
  it('opens with the N key', async () => {
    await renderScreen()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'n' })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Nouvelle carte')).toBeTruthy()
  })

  it('opens with the button in the session strip — the shortcut is not the only door', async () => {
    await renderScreen()
    fireEvent.click(
      screen.getByRole('button', { name: 'Ajouter une carte sans quitter la session (N)' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Nouvelle carte')).toBeTruthy()
  })

  it('hands the dialog the deck of the card on screen', async () => {
    await renderScreen()
    fireEvent.keyDown(window, { key: 'n' })
    await screen.findByRole('dialog')
    // `c1` lives in `deck-grammars`; `deck-automata` sorts first in the picker.
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Grammaires'))
  })

  it('closes back onto a session that has not moved', async () => {
    await renderScreen()
    fireEvent.keyDown(window, { key: 'n' })
    const dialog = await screen.findByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Still on the same card, still unrevealed, still in the session.
    expect(
      screen.getByRole('button', { name: 'Passer cette carte sans la noter (S)' }),
    ).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(postReview).not.toHaveBeenCalled()
  })
})
