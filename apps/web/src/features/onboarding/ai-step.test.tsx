// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MeResponse } from '@engram/shared'

/**
 * Step 3 of the first-run journey — the only step that asks for a secret, and
 * the one whose COPY Alex made a requirement: a refusal has to be explicit about
 * what it costs. These assertions are on the sentences, in both languages,
 * because a silent translation gap here means a user declines something they
 * were never told about.
 *
 * The `./queries` layer is mocked (same shape as `ai-settings-card.test.tsx`) so
 * no network is involved and the emitted PUT can be asserted directly.
 */

const { setKeyMutate, updateMutate } = vi.hoisted(() => ({
  setKeyMutate: vi.fn(),
  updateMutate: vi.fn(),
}))

vi.mock('@/features/ai/queries', () => ({
  useSetAiKey: () => ({ mutate: setKeyMutate, isPending: false }),
  useUpdateAiSettings: () => ({ mutate: updateMutate, isPending: false }),
}))

import { LangProvider } from '@/lib/i18n'
import { qk } from '@/lib/query-keys'
import { AiStep } from './ai-step'

afterEach(cleanup)

const store = new Map<string, string>()
beforeEach(() => {
  setKeyMutate.mockClear()
  updateMutate.mockClear()
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

const me = (isDemo: boolean): MeResponse => ({
  userId: 'u1',
  email: 'someone@example.test',
  isAdmin: false,
  isDemo,
  status: 'active',
  permissions: [],
})

function renderStep(opts: { lang?: 'fr' | 'en'; isDemo?: boolean; onSaved?: () => void } = {}) {
  localStorage.setItem('engram-lang', opts.lang ?? 'fr')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(qk.me, me(opts.isDemo ?? false))
  return render(
    <QueryClientProvider client={qc}>
      <LangProvider>
        <AiStep onSaved={opts.onSaved ?? (() => {})} />
      </LangProvider>
    </QueryClientProvider>,
  )
}

describe('what the step says about refusing', () => {
  it('names the three things that stop working, in French', () => {
    renderStep({ lang: 'fr' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('la génération de cartes et de QCM à partir d’une note')
    expect(text).toContain('l’exploitation du texte des PDF que tu importes')
    expect(text).toContain('la lecture (OCR) des photos de notes')
  })

  it('names the same three in English — no silent translation gap', () => {
    renderStep({ lang: 'en' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('generating cards and quizzes from a note')
    expect(text).toContain('making use of the text in the PDFs you import')
    expect(text).toContain('reading (OCR) photos of your notes')
  })

  it('says what still works, and that a key can come later — no guilt, no dead end', () => {
    renderStep({ lang: 'fr' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Tout le reste fonctionne')
    expect(text).toContain('plus tard depuis Réglages')
  })

  it('states, in both languages, that the key is stored server-side', () => {
    renderStep({ lang: 'fr' })
    expect(document.body.textContent).toContain('jamais réaffichée dans le navigateur')
    cleanup()
    renderStep({ lang: 'en' })
    expect(document.body.textContent).toContain('never shown back in the browser')
  })
})

describe('the key field', () => {
  it('starts empty, is a password field, and never autocompletes', () => {
    renderStep()
    const field = document.getElementById('onboarding-ai-key') as HTMLInputElement
    expect(field.value).toBe('')
    expect(field.type).toBe('password')
    expect(field.autocomplete).toBe('off')
  })

  it('refuses to submit nothing: the save button is disabled until a key is typed', () => {
    renderStep()
    const save = screen.getByRole('button', { name: 'Enregistrer et terminer' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(document.getElementById('onboarding-ai-key')!, { target: { value: ' sk-x ' } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends the TRIMMED key to the write-only endpoint, for the chosen provider', () => {
    renderStep()
    fireEvent.change(document.getElementById('onboarding-ai-key')!, {
      target: { value: '  sk-ant-abc  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer et terminer' }))
    expect(setKeyMutate).toHaveBeenCalledTimes(1)
    expect(setKeyMutate.mock.calls[0]?.[0]).toEqual({ provider: 'anthropic', key: 'sk-ant-abc' })
  })

  it('writes nothing at all when the step is merely displayed', () => {
    renderStep()
    expect(setKeyMutate).not.toHaveBeenCalled()
    expect(updateMutate).not.toHaveBeenCalled()
  })
})

describe('the demo account', () => {
  it('gets an explanation instead of a field it is not allowed to submit', () => {
    // The server refuses every AI write from the demo (`requireNotDemo`), and the
    // account is SHARED — offering the field would invite a visitor to paste a
    // personal key into it and collect a 403 for their trouble.
    renderStep({ isDemo: true })
    expect(document.getElementById('onboarding-ai-key')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer et terminer' })).toBeNull()
    expect(document.body.textContent).toContain('Compte de démonstration')
  })

  it('still reads what skipping costs — the explanation is for everyone', () => {
    renderStep({ isDemo: true })
    expect(document.body.textContent).toContain('la lecture (OCR) des photos de notes')
  })
})
