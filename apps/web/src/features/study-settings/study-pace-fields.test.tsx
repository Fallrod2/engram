// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { StudySettingsResponse } from '@engram/shared'

/**
 * The shared study-pace control, asserted on the ONE property that the whole
 * first-run journey rests on: MOUNTING IS NOT CHOOSING. Step 2 must be skippable
 * without leaving a single row behind, exactly like the theme and the language.
 *
 * `./queries` is mocked so the component renders without a QueryClient and the
 * emitted PATCH bodies can be read straight off the spy.
 */

const { updateMutate, response } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  response: { current: null as StudySettingsResponse | null, pending: false, error: false },
}))

vi.mock('./queries', () => ({
  studySettingsOptions: () => ({ queryKey: ['study-settings'], queryFn: vi.fn() }),
  useUpdateStudySettings: () => ({ mutate: updateMutate, isPending: false }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: response.current,
    isPending: response.pending,
    isError: response.error,
  }),
}))

import { LangProvider } from '@/lib/i18n'
import { StudyPaceFields } from './study-pace-fields'

afterEach(cleanup)

const store = new Map<string, string>()
beforeEach(() => {
  updateMutate.mockClear()
  response.pending = false
  response.error = false
  response.current = {
    settings: { newCardsPerDay: 20, dailyGoal: 30 },
    today: { day: '2026-07-29', newCardsIntroduced: 3, newCardsRemaining: 17, reviewsDone: 12 },
  }
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

function renderFields(lang: 'fr' | 'en' = 'fr') {
  localStorage.setItem('engram-lang', lang)
  return render(
    <LangProvider>
      <StudyPaceFields />
    </LangProvider>,
  )
}

const newCardsField = () => document.getElementById('pace-new-cards') as HTMLInputElement
const goalField = () => document.getElementById('pace-daily-goal') as HTMLInputElement

describe('mounting is not choosing', () => {
  it('writes nothing when it is merely displayed — this is what makes step 2 skippable', () => {
    renderFields()
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('writes nothing when a field is blurred without being changed', () => {
    renderFields()
    fireEvent.blur(newCardsField())
    fireEvent.blur(goalField())
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('writes nothing when a preset equal to the current value is clicked', () => {
    renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: '20' })[0]!)
    expect(updateMutate).not.toHaveBeenCalled()
  })
})

describe('committing a change', () => {
  it('PATCHes only the field that changed, on blur', () => {
    renderFields()
    fireEvent.change(newCardsField(), { target: { value: '40' } })
    fireEvent.blur(newCardsField())
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({ newCardsPerDay: 40 })
  })

  it('commits on Enter too, without a form submit', () => {
    renderFields()
    fireEvent.change(goalField(), { target: { value: '60' } })
    fireEvent.keyDown(goalField(), { key: 'Enter' })
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({ dailyGoal: 60 })
  })

  it('a preset click is a commit', () => {
    renderFields()
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({ newCardsPerDay: 0 })
  })

  it('restores the stored value when the field is left empty, instead of writing a default', () => {
    renderFields()
    fireEvent.change(newCardsField(), { target: { value: '' } })
    fireEvent.blur(newCardsField())
    expect(updateMutate).not.toHaveBeenCalled()
    expect(newCardsField().value).toBe('20')
  })

  it('clamps a goal of 0 up to the minimum the schema accepts', () => {
    renderFields()
    fireEvent.change(goalField(), { target: { value: '0' } })
    fireEvent.blur(goalField())
    expect(updateMutate.mock.calls[0]?.[0]).toEqual({ dailyGoal: 1 })
  })
})

describe('what the control explains', () => {
  it('translates 20 new cards a day into the load it actually implies', () => {
    renderFields()
    expect(document.body.textContent).toContain('60 à 100 révisions par jour')
  })

  it('says the same in English', () => {
    renderFields('en')
    expect(document.body.textContent).toContain('60 to 100 reviews a day')
  })

  it('shows where the user stands today, for both numbers', () => {
    renderFields()
    expect(document.body.textContent).toContain('3 / 20 nouvelles cartes introduites')
    expect(document.body.textContent).toContain('12 / 30 révisions aujourd’hui')
  })

  it('does not project a load when new cards are paused — it says they are paused', () => {
    response.current = {
      settings: { newCardsPerDay: 0, dailyGoal: 30 },
      today: { day: '2026-07-29', newCardsIntroduced: 0, newCardsRemaining: 0, reviewsDone: 0 },
    }
    renderFields()
    expect(document.body.textContent).toContain('Aucune nouvelle carte ne sera introduite')
    expect(document.body.textContent).not.toContain('0 à 0 révisions')
  })
})

describe('the load states', () => {
  it('shows a skeleton, never a value it does not have', () => {
    response.pending = true
    response.current = null
    renderFields()
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(document.getElementById('pace-new-cards')).toBeNull()
  })

  it('says so when the setting cannot be read, rather than showing the defaults', () => {
    response.error = true
    response.current = null
    renderFields()
    expect(document.body.textContent).toContain('indisponible')
    expect(document.getElementById('pace-new-cards')).toBeNull()
  })
})
