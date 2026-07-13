import { test, expect } from '@playwright/test'

/**
 * Invite/recovery onboarding (auth ON, no GoTrue). Covers the two branches that
 * need no network: an expired/used link surfaces a clear message on the bare
 * `/set-password` screen, and a direct visit with no active flow bounces to
 * /login. The happy path (setSession + updateUser) needs a GoTrue endpoint and is
 * covered by unit tests + manual functional verification. Run: `test:e2e:auth`.
 */
test.describe('invite/recovery onboarding', () => {
  test('an expired/used link → set-password screen shows the expired message', async ({ page }) => {
    await page.goto(
      '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    )
    await expect(page).toHaveURL(/\/set-password/)
    await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Retour à la connexion' })).toBeVisible()
    // The token/error fragment is stripped from the URL (never lingers in history).
    expect(new URL(page.url()).hash).toBe('')
  })

  test('direct visit with no active flow → redirect to /login', async ({ page }) => {
    await page.goto('/set-password')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })
})
