import { test, expect, type Page } from '@playwright/test'
import {
  AUTH_API_BASE,
  AUTH_STORAGE_KEY,
  AUTH_TEST_SECRET,
  mintJwt,
  seedSession,
} from '../fixtures/auth-env'

/**
 * OPT-IN auth-ON integration (spec §6.3, audit §10). Exercises the REAL chain
 * end-to-end with the gate enforced: token in storage → `lib/api.ts` header
 * injection → Hono middleware → protected content, then a dead token → 401 →
 * redirect to /login. Run with `bun run test:e2e:auth`.
 */
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

/** Seed a supabase-js session in storage BEFORE the app scripts run. */
async function seedStorage(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session))
    },
    [AUTH_STORAGE_KEY, seedSession(accessToken)] as const,
  )
}

test.describe('auth gate (ON, HS256)', () => {
  test('API rejects without a token and accepts a valid one', async ({ request }) => {
    const noToken = await request.get(`${AUTH_API_BASE}/api/subjects`)
    expect(noToken.status()).toBe(401)
    const body = (await noToken.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')

    const withToken = await request.get(`${AUTH_API_BASE}/api/subjects`, {
      headers: { Authorization: `Bearer ${token(AUTH_TEST_SECRET)}` },
    })
    expect(withToken.status()).toBe(200)
  })

  test('seeded session → protected app loads (Bearer injected end-to-end)', async ({ page }) => {
    await seedStorage(page, token(AUTH_TEST_SECRET))
    await page.goto('/')
    // The app shell mounts only when authenticated, and a dashboard API call had
    // to succeed for it to settle — proving the header reached the server.
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('dead token → 401 → redirect to /login', async ({ page }) => {
    // Structurally valid, WRONG signature → the server rejects it.
    await seedStorage(page, token('not-the-server-secret'))
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByLabel('E-mail')).toBeVisible()
  })
})
