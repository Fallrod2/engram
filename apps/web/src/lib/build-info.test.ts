// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { appVersionLabel, formatVersionLabel, siteHost } from './build-info'

/**
 * The point of these is the DEGRADATION, not the happy path: the About card
 * exists to stop printing a value that is not true, so every branch has to
 * produce something honest — and the one branch that must never come back is a
 * hard-coded number.
 */
describe('formatVersionLabel', () => {
  it('prints the commit and the build day', () => {
    expect(formatVersionLabel('4f3a9c1', '2026-07-29T21:13:04.000Z')).toBe('4f3a9c1 · 2026-07-29')
  })

  it('falls back to the commit alone when the build date is unknown', () => {
    expect(formatVersionLabel('4f3a9c1', '')).toBe('4f3a9c1')
  })

  it('falls back to the build day alone when git is unavailable (source tarball)', () => {
    expect(formatVersionLabel('', '2026-07-29T21:13:04.000Z')).toBe('2026-07-29')
  })

  it('says "dev" rather than inventing a version when it knows neither', () => {
    expect(formatVersionLabel('', '')).toBe('dev')
  })
})

describe('appVersionLabel', () => {
  it('never returns the hand-maintained 0.0.0 the card used to print', () => {
    expect(appVersionLabel()).not.toBe('0.0.0')
  })
})

describe('siteHost', () => {
  it('reports the host the page is actually served from', () => {
    // jsdom serves on localhost — i.e. exactly the developer case the landing's
    // browser frames must keep telling the truth about.
    expect(siteHost()).toBe(window.location.host)
  })
})
