/**
 * WHEN the first-run journey is allowed to interrupt a navigation.
 *
 * Two independent rules, both pure, both here rather than inlined in
 * `__root.tsx` — the router's `beforeLoad` is the one place in this app where a
 * wrong condition takes every screen down with it.
 */

/**
 * Routes the journey must NEVER intercept, and why each one is on the list:
 *
 *  `/onboarding`      — the journey itself. Redirecting it to itself is a loop.
 *  `/login` `/signup` `/forgot-password`
 *                     — there is nobody to onboard yet.
 *  `/set-password`    — an invite/recovery link. That flow owns the screen until
 *                       the password is set; the root layout already renders it
 *                       bare for exactly that reason.
 *  `/suspended`       — the account is locked out. Offering it a settings wizard
 *                       would be absurd, and every query behind the journey
 *                       would 403 anyway.
 *  `/welcome`         — the public landing, which renders bare on purpose and is
 *                       reachable while signed in (Settings → « À propos »).
 */
const EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/onboarding',
  '/login',
  '/signup',
  '/forgot-password',
  '/set-password',
  '/suspended',
  '/welcome',
])

export function isOnboardingExempt(pathname: string): boolean {
  // Trailing slash tolerated: the router normalizes, but a hand-typed URL or a
  // future `trailingSlash` setting must not turn the exemption off silently.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return EXEMPT_PATHS.has(normalized)
}

/**
 * THE ANTI-LOOP LATCH. The journey is offered AT MOST ONCE per page load.
 *
 * Without it, one failure mode is fatal instead of merely annoying: if the
 * completion PATCH does not reach the server, the cached status still reads
 * `pending`, so leaving the journey redirects straight back into it and the user
 * cannot get out — of the very screen designed to be skippable. With the latch,
 * the worst case is that the journey reappears on the NEXT full page load, which
 * is exactly what "the marker never got written" should look like.
 *
 * Module-scoped and not in the query cache on purpose: it is about this browsing
 * session, not about server state, and it must survive a cache invalidation.
 */
let offered = false

export function hasOfferedOnboarding(): boolean {
  return offered
}

export function markOnboardingOffered(): void {
  offered = true
}

/** Test-only reset — nothing in the app clears the latch. */
export function resetOnboardingOffer(): void {
  offered = false
}
