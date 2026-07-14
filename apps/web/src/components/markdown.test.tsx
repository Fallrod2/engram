// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Markdown } from './markdown'

afterEach(cleanup)

/**
 * Renderer tests (spec §2.1): inline/block math, broken formula → no crash,
 * math-free content → no KaTeX, and XSS attempts through piped formulas /
 * raw HTML are neutralised. Math renders through the lazy chunk, so the KaTeX
 * assertions await it via `waitFor`.
 */
describe('<Markdown> — KaTeX math', () => {
  it('renders inline math ($…$) as KaTeX', async () => {
    const { container } = render(<Markdown source={'complexity $O(n \\log n)$ here'} />)
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
    // The MathML annotation preserves the source TeX.
    expect(container.querySelector('annotation')?.textContent).toContain('O(n \\log n)')
  })

  it('renders block math ($$…$$ on its own lines) as a KaTeX display', async () => {
    // remark-math flow (display) mode requires the `$$` fences on their own
    // lines; a single-line `$$…$$` renders as inline KaTeX instead.
    const src = '$$\n\\begin{matrix}a & b \\\\ c & d\\end{matrix}\n$$'
    const { container } = render(<Markdown source={src} />)
    await waitFor(() => expect(container.querySelector('.katex-display')).toBeTruthy())
  })

  it('renders a broken formula as inline error, never throwing', async () => {
    const { container } = render(<Markdown source={'oops $\\frac{1}{$ end'} />)
    // KaTeX (throwOnError:false) emits a `.katex-error` node in its error color.
    await waitFor(() => expect(container.querySelector('.katex-error')).toBeTruthy())
    expect(screen.getByText(/oops/)).toBeTruthy()
  })

  it('leaves math-free content on the plain pipeline (no KaTeX)', () => {
    const { container } = render(<Markdown source={'plain **bold** text, no math'} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(screen.getByText('bold')).toBeTruthy()
  })

  it('treats a lone $ (a price) as text, not math', () => {
    const { container } = render(<Markdown source={'it costs $5 total'} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(screen.getByText(/costs \$5 total/)).toBeTruthy()
  })
})

describe('<Markdown> — XSS hardening', () => {
  it('neutralises \\href{javascript:…} (no anchor, no javascript: href)', async () => {
    const { container } = render(<Markdown source={'$\\href{javascript:alert(1)}{click}$'} />)
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toMatch(/href\s*=\s*["']?\s*javascript:/i)
  })

  it('neutralises \\url{javascript:…} (no anchor)', async () => {
    const { container } = render(<Markdown source={'$\\url{javascript:alert(1)}$'} />)
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
    expect(container.querySelector('a')).toBeNull()
  })

  it('strips raw HTML injected alongside math (img/onerror, script)', async () => {
    const src = 'x <img src=x onerror="alert(1)"> <script>alert(2)</script> $a^2$'
    const { container } = render(<Markdown source={src} />)
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toMatch(/onerror/i)
  })

  it('refuses \\includegraphics (no img resource loaded)', async () => {
    const { container } = render(<Markdown source={'$\\includegraphics{https://evil/x.png}$'} />)
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy())
    expect(container.querySelector('img')).toBeNull()
  })
})
