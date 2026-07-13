// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Photo-import preview flow (OCR spec §3.3) + the freeze rule (§3.3.1) at the
 * component level. The extraction + create-note mutations and the router are
 * mocked, so no network / real canvas is touched.
 */

interface ExtractCall {
  file: File
  resolve: (v: { markdown: string; mediaType: string; warnings: string[] }) => void
}

const { extractCalls, mutateAsync, createMutate } = vi.hoisted(() => {
  const extractCalls: ExtractCall[] = []
  const mutateAsync = vi.fn(
    (file: File) =>
      new Promise((resolve) => {
        extractCalls.push({ file, resolve: resolve as ExtractCall['resolve'] })
      }),
  )
  return { extractCalls, mutateAsync, createMutate: vi.fn() }
})

vi.mock('./queries', () => ({ useExtractImage: () => ({ mutateAsync }) }))
vi.mock('@/features/notes/queries', () => ({
  useCreateNote: () => ({ mutate: createMutate, isPending: false }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => children,
}))

import { PhotoImport } from './photo-import'

beforeAll(() => {
  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  extractCalls.length = 0
  mutateAsync.mockClear()
  createMutate.mockClear()
})

function renderTwoPhotos() {
  const f1 = new File(['1'], 'page1.jpg', { type: 'image/jpeg' })
  const f2 = new File(['2'], 'page2.jpg', { type: 'image/jpeg' })
  render(<PhotoImport files={[f1, f2]} subjects={[]} />)
}

async function resolvePage(index: number, markdown: string, warnings: string[] = []) {
  await act(async () => {
    extractCalls[index]!.resolve({ markdown, mediaType: 'image/jpeg', warnings })
  })
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText('Texte transcrit') as HTMLTextAreaElement
}

describe('<PhotoImport> flow', () => {
  it('assembles two segments in order and creates a note with the edited text', async () => {
    renderTwoPhotos()
    await waitFor(() => expect(extractCalls).toHaveLength(2))

    await resolvePage(0, 'Page A')
    expect(textarea().value).toBe('Page A')
    await resolvePage(1, 'Page B')
    expect(textarea().value).toBe('Page A\n\n---\n\nPage B')

    // Reorder: send the first page down → assembly reflects the new order.
    fireEvent.click(screen.getAllByLabelText('Descendre la page')[0]!)
    expect(textarea().value).toBe('Page B\n\n---\n\nPage A')

    fireEvent.click(screen.getByRole('button', { name: 'Créer la note' }))
    expect(createMutate).toHaveBeenCalledTimes(1)
    const payload = createMutate.mock.calls[0]![0] as {
      sourceType: string
      content: string
      originalFilename?: string
    }
    expect(payload.sourceType).toBe('image')
    expect(payload.content).toBe('Page B\n\n---\n\nPage A')
    expect(payload.originalFilename).toBe('cours (2 photos)')
  })

  it('re-extract of one page triggers exactly one more extraction call', async () => {
    renderTwoPhotos()
    await waitFor(() => expect(extractCalls).toHaveLength(2))
    await resolvePage(0, 'A')
    await resolvePage(1, 'B')
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getAllByLabelText('Réextraire cette page')[0]!)
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(3))
  })
})

describe('<PhotoImport> freeze rule (§3.3.1)', () => {
  it('a late resolution never clobbers a manual edit and surfaces the re-apply banner', async () => {
    renderTwoPhotos()
    await waitFor(() => expect(extractCalls).toHaveLength(2))

    await resolvePage(0, 'Page A')
    expect(textarea().value).toBe('Page A')

    // User corrects the textarea → definitive freeze.
    fireEvent.change(textarea(), { target: { value: 'Ma correction' } })
    expect(textarea().value).toBe('Ma correction')

    // The still-pending second page resolves AFTER the edit.
    await resolvePage(1, 'Page B')
    expect(textarea().value).toBe('Ma correction') // untouched
    const reapply = screen.getByRole('button', { name: /Réappliquer/ })
    expect(reapply).toBeTruthy()

    // Explicit re-apply overwrites on demand.
    fireEvent.click(reapply)
    expect(textarea().value).toBe('Page A\n\n---\n\nPage B')
  })
})
