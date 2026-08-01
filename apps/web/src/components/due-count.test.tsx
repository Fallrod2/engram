// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LangProvider } from '@/lib/i18n'
import { DueCount, DueDot } from './due-count'

afterEach(cleanup)

/** jsdom's Storage is not fully implemented here; `LangProvider` reads it. */
function installMockStorage() {
  const store = new Map<string, string>()
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
}

describe('<DueCount> intensity encoding (design §6.1)', () => {
  it('renders a retreating `·` in text-faint at zero', () => {
    render(<DueCount value={0} />)
    const el = screen.getByLabelText('0 à réviser')
    expect(el.textContent).toBe('·')
    expect(el.className).toContain('text-text-faint')
  })

  it('renders the number in text-muted for the low tier (1–20)', () => {
    const { container } = render(<DueCount value={12} />)
    const wrapper = screen.getByLabelText('12 à réviser')
    const number = wrapper.firstElementChild as HTMLElement
    expect(number.textContent).toBe('12')
    expect(number.className).toContain('text-text-muted')
    // No load bar below the high threshold.
    expect(container.querySelector('.w-8')).toBeNull()
  })

  it('renders the number in primary text for the mid tier (21–50), no bar', () => {
    const { container } = render(<DueCount value={35} />)
    const number = screen.getByLabelText('35 à réviser').firstElementChild as HTMLElement
    expect(number.textContent).toBe('35')
    expect(number.className).toContain('text-text')
    expect(number.className).not.toContain('text-text-muted')
    expect(container.querySelector('.w-8')).toBeNull()
  })

  it('adds a subject-tinted load bar for the high tier (>50) when a color is given', () => {
    const { container } = render(<DueCount value={120} colorHex="#7999f5" />)
    expect(screen.getByLabelText('120 à réviser').firstElementChild?.textContent).toBe('120')
    const bar = container.querySelector('.w-8')
    expect(bar).not.toBeNull()
    // Canonical hex resolves to the themeable pigment utility (never a raw color).
    expect(bar?.querySelector('.bg-subject-1')).not.toBeNull()
  })

  it('omits the load bar in the high tier when no color is supplied (neutral total)', () => {
    const { container } = render(<DueCount value={120} />)
    expect(container.querySelector('.w-8')).toBeNull()
  })
})

describe('<DueCount> backlog/today split (T-013)', () => {
  it('prints the two halves as a literal sum, backlog first and heavier', () => {
    const { container } = render(<DueCount value={17} overdue={12} label={null} />)
    expect(container.textContent).toBe('12+5')
    const backlog = screen.getByText('12')
    expect(backlog.className).toContain('font-semibold')
    expect(backlog.className).toContain('text-text')
    // The day's own load keeps the tone the whole count would have had (low tier).
    expect(screen.getByText('5').className).toContain('font-normal')
  })

  it('changes nothing at all when the backlog is zero', () => {
    const plain = render(<DueCount value={17} label={null} />).container.innerHTML
    const split = render(<DueCount value={17} overdue={0} label={null} />).container.innerHTML
    expect(split).toBe(plain)
    expect(plain).not.toContain('+')
  })

  it('omits the `+0` when everything due is backlog', () => {
    const { container } = render(<DueCount value={9} overdue={9} label={null} />)
    expect(container.textContent).toBe('9')
    expect(screen.getByText('9').className).toContain('font-semibold')
  })

  it('clamps a backlog that would exceed the total', () => {
    const { container } = render(<DueCount value={4} overdue={40} label={null} />)
    expect(container.textContent).toBe('4')
  })

  it('opts out of its own accessible name when the container carries it', () => {
    const { container } = render(<DueCount value={17} overdue={12} label={null} />)
    expect((container.firstChild as HTMLElement).hasAttribute('aria-label')).toBe(false)
  })

  /**
   * T-067 — this case used to pin `` `${value} à réviser` ``, a hardcoded French
   * template, as "the legacy label". It was not legacy, it was live: every
   * caller that omits `label` — the subject list on `/subjects`, the deck list
   * on a subject's page, one instance per row — went through it, so an English
   * screen reader was told "12 à réviser" on every row of both screens.
   *
   * `a11y-strings.test.ts` never saw it and could not have: the value reaches
   * the attribute through a spread object (`{...aria}`), not through the
   * `aria-label=` position that scan reads. So the behaviour is pinned here
   * instead, in BOTH languages — which is what the old case should have said.
   */
  it('names itself from the dictionary when the caller supplies no label', () => {
    render(<DueCount value={12} />)
    // Provider-free render = the default FR context, so the FR wording holds.
    expect(screen.getByLabelText('12 à réviser')).toBeTruthy()
  })

  it('says it in ENGLISH when the UI is English', () => {
    installMockStorage()
    localStorage.setItem('engram-lang', 'en')
    render(
      <LangProvider>
        <DueCount value={12} />
      </LangProvider>,
    )
    expect(screen.getByLabelText('12 due')).toBeTruthy()
    expect(screen.queryByLabelText(/à réviser/)).toBeNull()
  })

  it('takes the plural rule from the active locale, not from a hand-rolled `s`', () => {
    installMockStorage()
    localStorage.setItem('engram-lang', 'en')
    render(
      <LangProvider>
        <DueCount value={1} />
      </LangProvider>,
    )
    expect(screen.getByLabelText('1 due')).toBeTruthy()
  })
})

/**
 * T-042 — `·` is an ANSWER: "nothing due here". A dropped `GET /review/counts`
 * used to collapse to `0` on every row of every list at once, so one lost
 * request told a whole screen it was all caught up. Unknown is now its own mark.
 */
describe('<DueCount> unknown reads (T-042)', () => {
  it('renders an em-dash, not the zero tier, when the count is unknown', () => {
    render(<DueCount value={undefined} />)
    const el = screen.getByLabelText('Valeur indisponible')
    expect(el.textContent).toBe('—')
    expect(el.textContent).not.toBe('·')
  })

  it('still opts out of the accessible name when the caller owns the sentence', () => {
    const { container } = render(<DueCount value={undefined} label={null} />)
    expect((container.firstChild as HTMLElement).hasAttribute('aria-label')).toBe(false)
  })

  it('leaves a genuine zero saying `·`, as it always did', () => {
    render(<DueCount value={0} />)
    expect(screen.getByLabelText('0 à réviser').textContent).toBe('·')
  })
})

describe('<DueDot> collapsed-rail graduation (T-013)', () => {
  it('paints nothing at zero — the calm `·` has no dot form', () => {
    const { container } = render(<DueDot value={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('grows with the count across the shared 20/50 thresholds', () => {
    const sizes = [1, 20, 21, 50, 51, 400].map((v) => {
      const { container } = render(<DueDot value={v} />)
      const dot = container.querySelector('[data-due-tier]') as HTMLElement
      cleanup()
      return [dot.dataset.dueTier, dot.className.match(/size-[\d.]+/)?.[0]]
    })
    expect(sizes).toEqual([
      ['low', 'size-1'],
      ['low', 'size-1'],
      ['mid', 'size-1.5'],
      ['mid', 'size-1.5'],
      ['high', 'size-2'],
      ['high', 'size-2'],
    ])
  })

  it('marks a backlog by tone alone, so size keeps meaning quantity', () => {
    const { container } = render(<DueDot value={30} overdue={4} />)
    const dot = container.querySelector('[data-due-tier]') as HTMLElement
    expect(dot.dataset.dueBacklog).toBe('true')
    expect(dot.className).toMatch(/\bbg-text\b/)
    // No ring: it paints OUTSIDE the layout box, so a haloed `low` dot would
    // measure the same as a bare `high` one and the size axis would lie.
    expect(dot.className).not.toMatch(/\bring-/)
  })

  it('leaves a backlog-free dot faint and unmarked', () => {
    const { container } = render(<DueDot value={30} />)
    const dot = container.querySelector('[data-due-tier]') as HTMLElement
    expect(dot.dataset.dueBacklog).toBeUndefined()
    expect(dot.className).toContain('bg-text-faint')
    expect(dot.className).not.toMatch(/\bring-/)
  })

  it('keeps the painted box equal to the tier size, whatever the backlog', () => {
    // Same tier, both backlog states → same size class and no extra paint.
    for (const overdue of [0, 9]) {
      const { container } = render(<DueDot value={30} overdue={overdue} />)
      const dot = container.querySelector('[data-due-tier]') as HTMLElement
      expect(dot.className).toContain('size-1.5')
      expect(dot.className).not.toMatch(/\bring-|\bborder\b|\boutline\b/)
      cleanup()
    }
  })

  it('stays neutral and aria-hidden — never the accent, never the announcer', () => {
    const { container } = render(<DueDot value={80} overdue={80} />)
    const dot = container.querySelector('[data-due-tier]') as HTMLElement
    expect(dot.className).not.toMatch(/accent/)
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })
})
