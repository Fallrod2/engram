import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import {
  AUTH_ADMIN_SUB,
  AUTH_API_BASE,
  AUTH_DELEGATE_SUB,
  AUTH_STORAGE_KEY,
  AUTH_TEST_SECRET,
  mintJwt,
  seedSession,
} from '../fixtures/auth-env'

/**
 * OPT-IN auth-ON coverage of DELEGATED administration (rbac-groups §6.3). The
 * whole point of this feature is access control, so these specs prove — in a real
 * browser, through the real chain (supabase-js session → `lib/api` Bearer → Hono
 * gate → `/api/me` → the `/admin` guard, tabs, and row actions) — that:
 *
 *   (a) a member of a {users.view} group reaches /admin, sees the user list, but
 *       CANNOT suspend (the action is masked in the UI AND the server 403s);
 *   (b) a user with no permission is redirected off /admin (non-regression guard,
 *       exercised via the membership-REMOVAL path so it also proves that dropping
 *       the last granting group revokes access);
 *   (c) an admin creates a group, assigns it a permission, and adds a member —
 *       end to end in the browser — and the member then holds that permission.
 *
 * The harness pins `ENGRAM_ADMIN_USER_ID = AUTH_ADMIN_SUB` (see
 * `playwright.auth.config.ts`): a token with that `sub` is admin via the permanent
 * env filet; every other `sub` is a plain user whose only path to a permission is
 * a group the admin puts them in.
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

/** Force a fresh profile row to exist for `sub` (its first authed request creates it). */
async function ensureProfile(request: APIRequestContext, t: string): Promise<void> {
  const res = await request.get(`${AUTH_API_BASE}/api/me`, { headers: bearer(t) })
  expect(res.status()).toBe(200)
}

/** The caller's effective permissions, straight from `/api/me` (the server's word). */
async function permissionsOf(request: APIRequestContext, t: string): Promise<string[]> {
  const res = await request.get(`${AUTH_API_BASE}/api/me`, { headers: bearer(t) })
  expect(res.status()).toBe(200)
  return ((await res.json()) as { permissions: string[] }).permissions
}

/**
 * Provision a group with a permission set and a member, purely via the admin API —
 * the setup lever for the delegated scenarios (mirrors admin.spec.ts's API-driven
 * suspend). Returns the created group id. PUT /permissions is `requireAdmin` (the
 * escalation frontier, amendment A2), so only the env-admin token can call it.
 */
async function provisionGroup(
  request: APIRequestContext,
  adminToken: string,
  opts: { name: string; permissions: string[]; memberSub: string },
): Promise<string> {
  const created = await request.post(`${AUTH_API_BASE}/api/admin/groups`, {
    headers: bearer(adminToken),
    data: { name: opts.name },
  })
  expect(created.status()).toBe(201)
  const groupId = ((await created.json()) as { id: string }).id

  const perms = await request.put(`${AUTH_API_BASE}/api/admin/groups/${groupId}/permissions`, {
    headers: bearer(adminToken),
    data: { permissions: opts.permissions },
  })
  expect(perms.status()).toBe(200)

  const member = await request.post(`${AUTH_API_BASE}/api/admin/groups/${groupId}/members`, {
    headers: bearer(adminToken),
    data: { userId: opts.memberSub },
  })
  expect(member.status()).toBe(200)
  return groupId
}

test.describe('Delegated administration (ON, HS256)', () => {
  test('a {users.view} member reaches /admin read-only: list visible, cannot suspend (masked + 403)', async ({
    page,
    request,
  }) => {
    const admin = token(AUTH_ADMIN_SUB, 'admin@local')
    const delegate = token(AUTH_DELEGATE_SUB, 'delegate-view@local')
    // A concrete victim the delegate might try (and fail) to suspend.
    const victim = token('e2e-deleg-victim', 'deleg-victim@local')

    await ensureProfile(request, delegate)
    await ensureProfile(request, victim)

    // The admin grants the delegate exactly `users.view` through a group.
    await provisionGroup(request, admin, {
      name: `Support ${Date.now()}`,
      permissions: ['users.view'],
      memberSub: AUTH_DELEGATE_SUB,
    })
    // The server confirms the delegate now holds precisely that one permission.
    expect(await permissionsOf(request, delegate)).toEqual(['users.view'])

    // In the browser, the delegate reaches the console (NOT bounced) and sees users…
    await seedStorage(page, delegate, { id: AUTH_DELEGATE_SUB, email: 'delegate-view@local' })
    await page.goto('/admin')
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).toHaveURL(/\/admin/)
    await expect(page.locator('a[href="/admin"]').first()).toBeVisible()
    await expect(page.getByRole('table').getByText('deleg-victim@local')).toBeVisible()

    // …but only the Users tab is offered (no Groups tab — no `groups.manage`)…
    await expect(page.getByRole('tab', { name: 'Utilisateurs' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Groupes' })).toHaveCount(0)

    // …and NO per-row action menu is rendered (suspend et al. are masked): a
    // `users.view`-only delegate has no actionable row (amendment G1 mirror).
    await expect(page.getByRole('table').getByRole('button', { name: 'Actions' })).toHaveCount(0)

    // The server is the real authority: a direct suspend attempt is 403 `forbidden`.
    const attempt = await request.patch(
      `${AUTH_API_BASE}/api/admin/users/e2e-deleg-victim/status`,
      { headers: bearer(delegate), data: { status: 'suspended' } },
    )
    expect(attempt.status()).toBe(403)
    expect(((await attempt.json()) as { error: { code: string } }).error.code).toBe('forbidden')
    // And the victim is untouched — the failed call changed nothing.
    const check = await request.get(`${AUTH_API_BASE}/api/subjects`, { headers: bearer(victim) })
    expect(check.status()).toBe(200)
  })

  test('the admin creates a group, assigns a permission, and adds a member in the browser', async ({
    page,
    request,
  }) => {
    const managedSub = 'e2e-deleg-managed'
    const managed = token(managedSub, 'delegate-managed@local')
    await ensureProfile(request, managed) // so the directory search can find them

    // A membership grants nothing yet.
    expect(await permissionsOf(request, managed)).toEqual([])

    await seedStorage(page, token(AUTH_ADMIN_SUB, 'admin@local'), {
      id: AUTH_ADMIN_SUB,
      email: 'admin@local',
    })
    await page.goto('/admin?tab=groups')
    await expect(page.locator('#app-shell')).toBeVisible()

    const groupName = `Modérateurs ${Date.now()}`

    // Create the group + tick the `users.view` permission (admin-only toggle, A2).
    await page.getByRole('button', { name: 'Nouveau groupe' }).click()
    const form = page.getByRole('dialog')
    await expect(form).toBeVisible()
    await form.getByPlaceholder('ex. Modérateurs').fill(groupName)
    await form.getByRole('button', { name: 'Voir les utilisateurs' }).click()
    // `exact` — the `groups.manage` permission toggle's description also contains
    // the word "Créer", so a substring match would be ambiguous.
    await form.getByRole('button', { name: 'Créer', exact: true }).click()
    await expect(form).toBeHidden()

    // The new card shows the name and the granted-permission badge.
    const card = page.getByRole('main').getByRole('listitem').filter({ hasText: groupName })
    await expect(card).toBeVisible()
    await expect(card.getByText('Voir les utilisateurs')).toBeVisible()

    // Manage members → search the directory → add the delegate.
    await card.getByRole('button', { name: 'Actions du groupe' }).click()
    await page.getByRole('menuitem', { name: 'Gérer les membres' }).click()
    const members = page.getByRole('dialog')
    await expect(members).toBeVisible()
    await members.getByPlaceholder('Rechercher par email ou id…').fill('delegate-managed@local')
    await members.getByRole('button', { name: 'delegate-managed@local' }).click()
    // The member now appears with a remove control — proof the add landed.
    await expect(members.getByRole('button', { name: 'Retirer le membre' })).toBeVisible()

    // The server confirms the browser-driven grant took effect end to end.
    expect(await permissionsOf(request, managed)).toEqual(['users.view'])
  })

  test('a delegate removed from their only group loses access and is redirected off /admin', async ({
    page,
    request,
  }) => {
    const admin = token(AUTH_ADMIN_SUB, 'admin@local')
    const revokedSub = 'e2e-deleg-revoked'
    const revoked = token(revokedSub, 'delegate-revoked@local')
    await ensureProfile(request, revoked)

    // Grant, verify access, then revoke — all server-side — and verify it's gone.
    const groupId = await provisionGroup(request, admin, {
      name: `Temp ${Date.now()}`,
      permissions: ['users.view'],
      memberSub: revokedSub,
    })
    expect(await permissionsOf(request, revoked)).toEqual(['users.view'])

    const removed = await request.delete(
      `${AUTH_API_BASE}/api/admin/groups/${groupId}/members/${encodeURIComponent(revokedSub)}`,
      { headers: bearer(admin) },
    )
    expect(removed.status()).toBe(200)
    expect(await permissionsOf(request, revoked)).toEqual([])

    // With no permission left, the blocking guard bounces them to '/' before the
    // console mounts (no admin flash, no sidebar entry, no admin content).
    await seedStorage(page, revoked, { id: revokedSub, email: 'delegate-revoked@local' })
    await page.goto('/admin')
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page).not.toHaveURL(/\/admin/)
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
  })
})
