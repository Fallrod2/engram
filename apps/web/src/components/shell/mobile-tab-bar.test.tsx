// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * Mobile bottom nav (fix-mobile-shell §nav): Import must be a first-class tab so
 * the phone-flagship photo flow is reachable without the command palette. The
 * router `<Link>` is stubbed to a plain anchor so no RouterProvider is needed.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

import { MobileTabBar } from './mobile-tab-bar'

afterEach(cleanup)

describe('<MobileTabBar>', () => {
  it('exposes the five core sections including Import', () => {
    render(<MobileTabBar />)
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/review', '/subjects', '/planning', '/analytics', '/import'])
    expect(screen.getByText('Import')).toBeTruthy()
  })
})
