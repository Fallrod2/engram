import { test, expect } from '@playwright/test'
import { AUTH_TEST_SECRET, mintJwt } from '../fixtures/auth-env'

/**
 * Public sign-up confirmation flow (spec BYOK §2, auth ON, no GoTrue). A GoTrue
 * `type=signup` confirmation link drops the session tokens in the URL fragment;
 * `captureAuthLink` → `init()` must establish the session and land the user IN
 * THE APP, WITHOUT ever passing through the `/set-password` gate (the password
 * was already chosen at sign-up).
 *
 * supabase-js `setSession()` calls `GET {VITE_SUPABASE_URL}/auth/v1/user` to
 * hydrate the user when the token is not expired (amendment §9). In this suite
 * `VITE_SUPABASE_URL` points at the REAL local Supabase stack, which would 401
 * the fake anon key → the flow would error onto "link expired". So we STUB that
 * one endpoint (never touching the real stack) and let the rest run for real.
 * Run: `test:e2e:auth`.
 */

function signupToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000)
  return mintJwt(
    {
      sub,
      role: 'authenticated',
      aud: 'authenticated',
      email: `${sub}@local`,
      iat: now,
      exp: now + 86_400,
    },
    AUTH_TEST_SECRET,
  )
}

test.describe('public sign-up confirmation', () => {
  test('a type=signup link establishes the session and enters the app (no /set-password)', async ({
    page,
  }) => {
    const sub = 'e2e-signup-user'
    const accessToken = signupToken(sub)

    // Stub ONLY the GoTrue /user hydration call — never hit the real stack.
    await page.route('**/auth/v1/user', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: sub,
          aud: 'authenticated',
          role: 'authenticated',
          email: `${sub}@local`,
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        }),
      })
    })

    await page.goto(`/#access_token=${accessToken}&refresh_token=e2e-refresh&type=signup`)

    // Lands in the authenticated app shell, NOT on the set-password gate.
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).not.toHaveURL(/\/set-password/)
    // The token fragment is stripped from the URL (never lingers in history).
    expect(new URL(page.url()).hash).toBe('')
  })
})
