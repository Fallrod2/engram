import { describe, expect, it } from 'vitest'
import { dictEn } from '@/lib/i18n/dict.en'
import { dictFr } from '@/lib/i18n/dict.fr'
import { getPageTitleKey, shellOwnsHeading } from './page-title'

/**
 * T-041 — the shell header must name the route it is showing.
 *
 * `/admin` fell through to `pageTitle.fallback`, so its header read "engram"
 * while the page below it read "Administration". The other two routes named in
 * the ticket, `/welcome` and `/suspended`, never reach this module at all:
 * `RootLayout` returns them as a bare `<Outlet/>`, outside the shell. They are
 * covered where they actually have a title — the browser tab — and the map's
 * doc comment says so rather than carrying dead entries that look like coverage.
 */
describe('page titles', () => {
  it('names /admin instead of falling back to the app name', () => {
    expect(getPageTitleKey('/admin')).toBe('pageTitle.admin')
  })

  it('translates the admin title in both dictionaries', () => {
    expect(dictFr.pageTitle.admin).toBe('Administration')
    expect(dictEn.pageTitle.admin).toBe('Administration')
  })

  it('leaves the <h1> on /admin to the page, which already renders one', () => {
    // Naming the route without this would have produced TWO <h1>s both saying
    // "Administration" — a regression dressed as a fix.
    expect(shellOwnsHeading('/admin')).toBe(false)
  })

  it('still gives every other section root its heading', () => {
    for (const path of ['/', '/planning', '/analytics', '/search', '/settings']) {
      expect(shellOwnsHeading(path), path).toBe(true)
    }
  })

  it('gives the suspended screen a document title in both languages', () => {
    // The one bare route that named nothing; every other one already calls
    // `useDocumentTitle`.
    expect(dictFr.admin.suspended.meta).toContain('engram')
    expect(dictEn.admin.suspended.meta).toContain('engram')
    expect(dictFr.admin.suspended.meta).not.toBe(dictEn.admin.suspended.meta)
  })
})
