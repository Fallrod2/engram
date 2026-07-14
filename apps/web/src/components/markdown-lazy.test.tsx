// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// Track whether the lazy KaTeX chunk is ever imported. The factory runs the
// first (and only the first) time `import('./markdown-math')` resolves, so the
// flag proves whether the dynamic import fired at all (spec §2.1: math-free
// content must NOT load the chunk). A light stand-in avoids pulling real KaTeX.
const tracker = vi.hoisted(() => ({ imported: false }))
vi.mock('./markdown-math', () => {
  tracker.imported = true
  return {
    default: ({ source }: { source: string }) => <div data-testid="math-chunk">{source}</div>,
  }
})

// Imported AFTER the mock is declared so the lazy factory picks up the stub.
const { Markdown } = await import('./markdown')

afterEach(cleanup)

describe('<Markdown> lazy KaTeX chunk loading', () => {
  it('does NOT import the math chunk for math-free content', async () => {
    render(<Markdown source={'plain text, absolutely no math here'} />)
    // Give any (erroneous) dynamic import a chance to resolve.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(tracker.imported).toBe(false)
    expect(screen.queryByTestId('math-chunk')).toBeNull()
  })

  it('imports the math chunk when content contains math', async () => {
    render(<Markdown source={'energy $E = mc^2$'} />)
    await waitFor(() => expect(screen.getByTestId('math-chunk')).toBeTruthy())
    expect(tracker.imported).toBe(true)
  })
})
