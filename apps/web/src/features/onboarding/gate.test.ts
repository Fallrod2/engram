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
