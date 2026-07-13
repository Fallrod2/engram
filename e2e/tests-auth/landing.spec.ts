import { test, expect } from '@playwright/test'

/**
 * Public landing with the auth gate ON (landing spec §5.2). This suite builds the
 * web app with a non-empty VITE_SUPABASE_URL, so the supabase client is real and
 * the router guard is active — but no session is seeded here, so the visitor is
 * genuinely anonymous. `getSession()` reads empty storage (never contacts the
 * fake URL) → status `unauthenticated` → `requireAuth` exempts `/` → the landing
 * renders instead of bouncing to /login. Clicking "Se connecter" then reaches
 * /login. Deep-route protection is asserted separately (auth-gate.spec.ts).
 */
test.describe('public landing (auth ON, anonymous visitor)', () => {
  test('/ shows the landing; "Se connecter" leads to /login', async ({ page }) => {
    await page.goto('/')
    // No redirect to /login: the landing is public.
    await expect(page).not.toHaveURL(/\/login/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Retiens plus, en révisant moins.' }),
    ).toBeVisible()

    // The primary CTA (header) navigates to the sign-in screen.
    await page.getByRole('link', { name: 'Se connecter' }).first().click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })
})
