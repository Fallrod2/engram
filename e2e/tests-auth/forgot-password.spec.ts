import { test, expect } from '@playwright/test'

/**
 * Public "forgot password" flow (audit MAJOR: the account dead-end fix). Runs the
 * real chain with auth ON but no GoTrue container, so the single GoTrue endpoint
 * the flow hits — `POST /auth/v1/recover` (supabase-js `resetPasswordForEmail`) —
 * is stubbed; the real local stack is never touched. Verifies the page is
 * reachable from `/login`, and that submitting reaches the neutral "email sent"
 * screen (anti-enumeration). Run: `test:e2e:auth`.
 */
test.describe('forgot password', () => {
  test('is reachable directly and shows the request form', async ({ page }) => {
    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible()
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })

  test('is reachable from the login screen (no dead-end)', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click()
    await expect(page).toHaveURL(/\/forgot-password/)
    await expect(page.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible()
  })

  test('submitting a valid email → neutral "email sent" screen', async ({ page }) => {
    // Stub ONLY the GoTrue recover endpoint — never hit the real stack.
    await page.route('**/auth/v1/recover', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/forgot-password')
    await page.getByLabel('E-mail').fill('alex@example.com')
    await page.getByRole('button', { name: 'Envoyer le lien' }).click()
    await expect(page.getByRole('heading', { name: 'Vérifie ta boîte mail' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Retour à la connexion' })).toBeVisible()
  })
})
