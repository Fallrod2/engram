import { beforeEach, describe, expect, it } from 'vitest'
import {
  hasOfferedOnboarding,
  isOnboardingExempt,
  markOnboardingOffered,
  resetOnboardingOffer,
} from './gate'

beforeEach(resetOnboardingOffer)

describe('isOnboardingExempt', () => {
  it('never intercepts the journey itself (that would be a redirect loop)', () => {
    expect(isOnboardingExempt('/onboarding')).toBe(true)
  })

  it('never intercepts a screen where there is nobody to onboard', () => {
    for (const p of ['/login', '/signup', '/forgot-password']) {
      expect(isOnboardingExempt(p), p).toBe(true)
    }
  })

  it('never intercepts the flows that own their screen', () => {
    // set-password is an invite/recovery link; suspended is a locked-out account;
    // welcome is the public landing, reachable while signed in.
    for (const p of ['/set-password', '/suspended', '/welcome']) {
      expect(isOnboardingExempt(p), p).toBe(true)
    }
  })

  it('DOES intercept the dashboard and the ordinary app screens', () => {
    for (const p of ['/', '/subjects', '/planning', '/analytics', '/settings', '/import']) {
      expect(isOnboardingExempt(p), p).toBe(false)
    }
  })

  it('tolerates a trailing slash rather than silently losing the exemption', () => {
    expect(isOnboardingExempt('/onboarding/')).toBe(true)
    expect(isOnboardingExempt('/login/')).toBe(true)
    // …and the root is still the root, not an empty string.
    expect(isOnboardingExempt('/')).toBe(false)
  })
})

describe('the anti-loop latch', () => {
  it('starts unset and latches once', () => {
    expect(hasOfferedOnboarding()).toBe(false)
    markOnboardingOffered()
    expect(hasOfferedOnboarding()).toBe(true)
    markOnboardingOffered()
    expect(hasOfferedOnboarding()).toBe(true)
  })

  it('is what stops a failed completion from trapping the user in the journey', () => {
    // The scenario, spelled out: the PATCH never lands, so the cached status
    // still says `pending`. The FIRST navigation is redirected; the second is
    // not, so leaving the journey works even when the marker was never written.
    const wouldRedirect = () => !hasOfferedOnboarding()
    expect(wouldRedirect()).toBe(true)
    markOnboardingOffered()
    expect(wouldRedirect()).toBe(false)
  })
})

/**
 * The gate's own contribution to the race fixed in `onboarding-flow.tsx`: an
 * exempt path returns BEFORE latching, on purpose, and that is precisely why
 * `finish()` has to latch by itself. The ordering assertion lives with the
 * component (`onboarding-flow.test.tsx`); what belongs here is the precondition
 * — that landing on the journey leaves the gate unlatched, and that this is
 * required rather than an oversight.
 */
describe('the state a direct landing leaves behind', () => {
  /** The gate's decision, in the order `__root.tsx` takes it. */
  function visit(pathname: string): 'skipped' | 'probed' {
    if (hasOfferedOnboarding()) return 'skipped'
    if (isOnboardingExempt(pathname)) return 'skipped'
    markOnboardingOffered() // `__root.tsx` latches on the probe's resolution
    return 'probed'
  }

  it('leaves the latch UNSET after landing straight on /onboarding', () => {
    // A reload mid-journey, or « Revoir » opened in a new tab. Nothing has been
    // probed, so nothing has been latched — and the very next navigation would
    // probe, racing the completion PATCH, if `finish()` did not latch first.
    expect(visit('/onboarding')).toBe('skipped')
    expect(hasOfferedOnboarding()).toBe(false)
    expect(visit('/')).toBe('probed')
  })

  it('must NOT latch on an exempt path — that would swallow the real entry point', () => {
    // The tempting "fix" is to latch inside the gate for every path. It breaks
    // the main flow: a new user signs in on /login (exempt), then lands on /,
    // and that landing is the one moment the journey is supposed to be offered.
    expect(visit('/login')).toBe('skipped')
    expect(visit('/')).toBe('probed')
  })

  it('probes at most once per page load, whatever the route sequence', () => {
    expect(visit('/')).toBe('probed')
    for (const p of ['/subjects', '/planning', '/settings', '/']) {
      expect(visit(p), p).toBe('skipped')
    }
  })
})
