import { test, expect, type Page } from '@playwright/test'
import {
  AUTH_LINK_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  AUTH_TEST_SECRET,
  mintJwt,
  seedSession,
} from '../fixtures/auth-env'

/**
 * Invite/recovery onboarding (auth ON, no GoTrue). Covers the branches that need no
 * network: an expired/used link surfaces a clear message on the bare `/set-password`
 * screen AND its "back to login" escape works; a direct visit with no active flow
 * bounces to /login; and a reload mid-onboarding stays gated (no auth bypass). The
 * happy path (setSession + updateUser) needs a GoTrue endpoint and is covered by
 * unit tests + manual functional verification. Run: `test:e2e:auth`.
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

  test('expired link → "Retour à la connexion" actually reaches /login (no dead-end)', async ({
    page,
  }) => {
    await page.goto(
      '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    )
    await expect(page).toHaveURL(/\/set-password/)
    await page.getByRole('link', { name: 'Retour à la connexion' }).click()
    // Must land on /login and stay there — not bounce straight back to set-password.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
    await expect(page).not.toHaveURL(/\/set-password/)
  })

  test('direct visit with no active flow → redirect to /login', async ({ page }) => {
    await page.goto('/set-password')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })

  test('reload mid-onboarding (session + setup marker) → still gated, never enters the app', async ({
    page,
  }) => {
    // Simulate the state left after arriving via an invite link and reloading before
    // choosing a password: supabase-js has persisted the recovery session AND the
    // store persisted the setup marker. The URL no longer carries any token.
    await seedSetupReload(page, token(AUTH_TEST_SECRET))
    await page.goto('/')
    // The guard must force the bare set-password screen, NOT the authenticated shell.
    await expect(page).toHaveURL(/\/set-password/)
    await expect(page.locator('#app-shell')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /mot de passe/i })).toBeVisible()
  })
})

function token(secret: string): string {
  const now = Math.floor(Date.now() / 1000)
  return mintJwt(
    {
      sub: 'e2e-user',
      role: 'authenticated',
      aud: 'authenticated',
      email: 'test@local',
      iat: now,
      exp: now + 86_400,
    },
    secret,
  )
}

/** Seed a persisted session AND the in-progress setup marker before scripts run. */
async function seedSetupReload(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript(
    ([sessionKey, markerKey, session]) => {
      window.localStorage.setItem(sessionKey as string, JSON.stringify(session))
      window.localStorage.setItem(markerKey as string, 'invite')
    },
    [AUTH_STORAGE_KEY, AUTH_LINK_STORAGE_KEY, seedSession(accessToken)] as const,
  )
}
