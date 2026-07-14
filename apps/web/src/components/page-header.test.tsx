// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PageHeader } from './page-header'

afterEach(cleanup)

describe('<PageHeader> (fix-mobile-shell §PageHeader)', () => {
  it('stacks under sm so the title is never squeezed to 0px by the actions', () => {
    const { container } = render(
      <PageHeader title="Irregular verbs" actions={<button type="button">Réviser</button>} />,
    )
    const root = container.firstElementChild as HTMLElement
    // Column on phones, row from sm — the title keeps full width below sm.
    expect(root.className).toContain('flex-col')
    expect(root.className).toContain('sm:flex-row')
    // The h1 must not carry `truncate` (which, in the old single-row layout,
    // collapsed the title to 0px behind the action buttons).
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.className).not.toContain('truncate')
  })

  it('lets a crowded action bar wrap instead of overflowing', () => {
    const { container } = render(
      <PageHeader title="Anglais" actions={<button type="button">Nouveau deck</button>} />,
    )
    const actions = container.querySelector('.flex-wrap')
    expect(actions).not.toBeNull()
  })
})
