import { test, expect, type Page } from '@playwright/test'
import {
  AUTH_ADMIN_SUB,
  AUTH_API_BASE,
  AUTH_STORAGE_KEY,
  AUTH_TEST_SECRET,
  mintJwt,
  seedSession,
} from '../fixtures/auth-env'

/**
 * OPT-IN auth-ON coverage of the IAM admin console (spec §5.3, amendment A14).
 * The harness pins `ENGRAM_ADMIN_USER_ID = AUTH_ADMIN_SUB` (see
 * `playwright.auth.config.ts`), so a token with that `sub` is admin via the
 * permanent env filet and any other `sub` is a plain user. Everything runs the
 * REAL chain: supabase-js session → `lib/api` Bearer injection → Hono gate →
 * `/api/me` → the `/admin` route guard, sidebar entry, and the suspension 403.
 */
function token(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000)
  return mintJwt(
    { sub, role: 'authenticated', aud: 'authenticated', email, iat: now, exp: now + 86_400 },
    AUTH_TEST_SECRET,
  )
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

/** Seed a supabase-js session (with a MATCHING user id/email) before app scripts run. */
async function seedStorage(page: Page, accessToken: string, user: { id: string; email: string }) {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session))
    },
    [AUTH_STORAGE_KEY, seedSession(accessToken, user)] as const,
  )
}

test.describe('IAM admin console (ON, HS256)', () => {
  test('the admin opens /admin, lists users, and sees the sidebar entry', async ({
    page,
    request,
  }) => {
    // A distinctive user exists (its first authed request lazily creates its
    // profile), so the admin list has something concrete to show.
    const listed = token('e2e-listed-user', 'e2e-listed@local')
    const created = await request.get(`${AUTH_API_BASE}/api/me`, { headers: bearer(listed) })
    expect(created.status()).toBe(200)

    await seedStorage(page, token(AUTH_ADMIN_SUB, 'admin@local'), {
      id: AUTH_ADMIN_SUB,
      email: 'admin@local',
    })
    await page.goto('/admin')

    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).toHaveURL(/\/admin/) // not bounced
    // The conditional sidebar entry is present for an admin.
    await expect(page.locator('a[href="/admin"]').first()).toBeVisible()
    // The users table rendered and lists the seeded account. Scope to the
    // desktop table: the responsive console also renders a mobile card list in
    // the DOM, so an unscoped getByText matches twice (strict-mode violation).
    await expect(page.getByRole('table').getByText('e2e-listed@local')).toBeVisible()
  })

  test('a non-admin is bounced from /admin with no admin content and no sidebar entry', async ({
    page,
  }) => {
    await seedStorage(page, token('e2e-plain-user', 'plain@local'), {
      id: 'e2e-plain-user',
      email: 'plain@local',
    })
    await page.goto('/admin')

    // The blocking guard redirects to '/' before the console can mount (no flash).
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
    // The admin surface never renders for a non-admin: no console, no sidebar entry.
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
    await expect(page.getByText('e2e-listed@local')).toHaveCount(0)
  })

  test('the admin suspends a user, who is then blocked with 403 suspended', async ({ request }) => {
    const admin = token(AUTH_ADMIN_SUB, 'admin@local')
    const victim = token('e2e-suspend-target', 'suspendme@local')

    // The victim can read normally (and its profile now exists).
    const before = await request.get(`${AUTH_API_BASE}/api/subjects`, { headers: bearer(victim) })
    expect(before.status()).toBe(200)

    // The admin suspends the victim.
    const patch = await request.patch(
      `${AUTH_API_BASE}/api/admin/users/e2e-suspend-target/status`,
      { headers: bearer(admin), data: { status: 'suspended' } },
    )
    expect(patch.status()).toBe(200)

    // Now every normal route is 403 `suspended`…
    const blocked = await request.get(`${AUTH_API_BASE}/api/subjects`, { headers: bearer(victim) })
    expect(blocked.status()).toBe(403)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('suspended')

    // …but /api/me stays 200 so the UI can explain WHY (amendment A3).
    const me = await request.get(`${AUTH_API_BASE}/api/me`, { headers: bearer(victim) })
    expect(me.status()).toBe(200)
    expect(((await me.json()) as { status: string }).status).toBe('suspended')
  })
})
