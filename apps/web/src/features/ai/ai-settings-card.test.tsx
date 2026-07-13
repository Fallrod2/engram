// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AiProviderStatus, AiSettings } from '@engram/shared'

/**
 * OCR sub-section of the AI settings card (spec §4.2): choosing a dedicated OCR
 * provider/model, distinct from generation. The whole `./queries` layer is
 * mocked (mirrors photo-import.test.tsx), so no network / QueryClient is needed;
 * we render `OcrSettingsSection` directly and assert the PATCH partials it emits.
 */

const { updateMutate, setKeyMutate, deleteKeyMutate, testMutate } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  setKeyMutate: vi.fn(),
  deleteKeyMutate: vi.fn(),
  testMutate: vi.fn(),
}))

vi.mock('./queries', () => ({
  aiSettingsOptions: () => ({ queryKey: ['ai'], queryFn: vi.fn() }),
  useUpdateAiSettings: () => ({ mutate: updateMutate, isPending: false }),
  useSetAiKey: () => ({ mutate: setKeyMutate, isPending: false }),
  useDeleteAiKey: () => ({ mutate: deleteKeyMutate, isPending: false }),
  useTestConnection: () => ({ mutate: testMutate, isPending: false }),
  useProviderModels: () => ({ data: undefined, refetch: vi.fn(), isFetching: false }),
}))

import { OcrSettingsSection } from './ai-settings-card'

const PROVIDER_CONFIG = {
  anthropic: { model: 'claude-sonnet-4-6' },
  openrouter: { model: 'anthropic/claude-3.5-sonnet' },
  ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
  'openai-compat': { baseUrl: '', model: '' },
  mistral: { model: 'mistral-small-latest' },
}

function makeSettings(ocr: AiSettings['ocr']): AiSettings {
  return { activeProvider: 'anthropic', providers: PROVIDER_CONFIG, ocr }
}

const STATUSES: AiProviderStatus[] = [
  {
    provider: 'mistral',
    requiresKey: true,
    hasKey: false,
    keySource: null,
    model: 'mistral-small-latest',
    active: false,
    ocrActive: true,
  },
]

afterEach(() => {
  cleanup()
  updateMutate.mockClear()
  setKeyMutate.mockClear()
  deleteKeyMutate.mockClear()
  testMutate.mockClear()
})

describe('<OcrSettingsSection> toggle state', () => {
  it("mode 'same' hides the dedicated provider/model config", () => {
    render(
      <OcrSettingsSection
        settings={makeSettings({ mode: 'same', provider: 'mistral', model: 'mistral-ocr-latest' })}
        statuses={STATUSES}
      />,
    )
    // The section header is always present.
    expect(screen.getByText('OCR / Import photo')).toBeTruthy()
    // The dedicated OCR model input only exists in custom mode.
    expect(screen.queryByLabelText('Modèle OCR')).toBeNull()
  })

  it("mode 'custom' reveals the OCR model input, seeded from the stored model", () => {
    render(
      <OcrSettingsSection
        settings={makeSettings({
          mode: 'custom',
          provider: 'mistral',
          model: 'mistral-ocr-latest',
        })}
        statuses={STATUSES}
      />,
    )
    const model = screen.getByLabelText('Modèle OCR') as HTMLInputElement
    expect(model.value).toBe('mistral-ocr-latest')
  })
})

describe('<OcrSettingsSection> PATCH partials', () => {
  it('saving the OCR model emits a partial { ocr: { model } } PATCH', () => {
    render(
      <OcrSettingsSection
        settings={makeSettings({
          mode: 'custom',
          provider: 'mistral',
          model: 'mistral-ocr-latest',
        })}
        statuses={STATUSES}
      />,
    )
    fireEvent.change(screen.getByLabelText('Modèle OCR'), {
      target: { value: 'mistral-ocr-2505' },
    })
    // Two "Enregistrer" buttons exist (key + model); the model save is the last.
    const saves = screen.getAllByRole('button', { name: 'Enregistrer' })
    fireEvent.click(saves[saves.length - 1]!)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0]![0]).toEqual({ ocr: { model: 'mistral-ocr-2505' } })
  })

  it('saving a key targets the OCR provider (shared credential, no new endpoint)', () => {
    render(
      <OcrSettingsSection
        settings={makeSettings({
          mode: 'custom',
          provider: 'mistral',
          model: 'mistral-ocr-latest',
        })}
        statuses={STATUSES}
      />,
    )
    fireEvent.change(screen.getByLabelText('Clé API'), { target: { value: 'mist-key' } })
    const saves = screen.getAllByRole('button', { name: 'Enregistrer' })
    fireEvent.click(saves[0]!) // key save comes before the model save
    expect(setKeyMutate).toHaveBeenCalledTimes(1)
    expect(setKeyMutate.mock.calls[0]![0]).toMatchObject({ provider: 'mistral', key: 'mist-key' })
  })
})

describe('<OcrSettingsSection> local resync', () => {
  it('the OCR model input follows a changed stored model (resync on prop change)', () => {
    const { rerender } = render(
      <OcrSettingsSection
        settings={makeSettings({
          mode: 'custom',
          provider: 'mistral',
          model: 'mistral-ocr-latest',
        })}
        statuses={STATUSES}
      />,
    )
    expect((screen.getByLabelText('Modèle OCR') as HTMLInputElement).value).toBe(
      'mistral-ocr-latest',
    )
    rerender(
      <OcrSettingsSection
        settings={makeSettings({
          mode: 'custom',
          provider: 'mistral',
          model: 'pixtral-large-latest',
        })}
        statuses={STATUSES}
      />,
    )
    expect((screen.getByLabelText('Modèle OCR') as HTMLInputElement).value).toBe(
      'pixtral-large-latest',
    )
  })
})
