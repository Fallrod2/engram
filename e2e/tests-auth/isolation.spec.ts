import { test, expect, type Page } from '@playwright/test'
import {
  AUTH_API_BASE,
  AUTH_STORAGE_KEY,
  AUTH_TEST_SECRET,
  mintJwt,
  seedSession,
} from '../fixtures/auth-env'

/**
 * Real end-to-end multi-user isolation (spec §6.5). Two HS256 tokens with
 * DIFFERENT `sub`s drive the REAL chain (token → lib/api header → Hono gate →
 * scoped services). User A creates a subject through the API; user B must not see
 * it — neither through the API nor in the rendered dashboard.
 */
function token(sub: string): string {
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

async function seedStorage(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session))
    },
    [AUTH_STORAGE_KEY, seedSession(accessToken)] as const,
  )
}

const SUBJECT_NAME = 'Secret-A-Subject-Isolation'

test.describe('multi-user isolation (ON, HS256)', () => {
  test('A’s subject is invisible to B (API + UI)', async ({ request, page }) => {
    const a = token('iso-user-a')
    const b = token('iso-user-b')

    // A creates a subject.
    const created = await request.post(`${AUTH_API_BASE}/api/subjects`, {
      headers: { Authorization: `Bearer ${a}` },
      data: { name: SUBJECT_NAME, color: '#123456', icon: 'book' },
    })
    expect(created.status()).toBe(201)

    // A sees it; B does not (API scoping).
    const listA = (await (
      await request.get(`${AUTH_API_BASE}/api/subjects`, {
        headers: { Authorization: `Bearer ${a}` },
      })
    ).json()) as { name: string }[]
    expect(listA.some((s) => s.name === SUBJECT_NAME)).toBe(true)

    const listB = (await (
      await request.get(`${AUTH_API_BASE}/api/subjects`, {
        headers: { Authorization: `Bearer ${b}` },
      })
    ).json()) as { name: string }[]
    expect(listB.some((s) => s.name === SUBJECT_NAME)).toBe(false)

    // B’s dashboard never renders A’s subject.
    await seedStorage(page, b)
    await page.goto('/')
    await expect(page.locator('#app-shell')).toBeVisible()
    await expect(page.getByText(SUBJECT_NAME)).toHaveCount(0)
  })

  test('AI config + key are per-user: B never sees A’s key (BYOK §1)', async ({ request }) => {
    const a = token('ai-iso-user-a')
    const b = token('ai-iso-user-b')

    // A brings its OWN key (BYOK) and switches its active provider.
    const put = await request.put(`${AUTH_API_BASE}/api/ai/providers/openrouter/key`, {
      headers: { Authorization: `Bearer ${a}` },
      data: { key: 'a-openrouter-secret' },
    })
    expect(put.status()).toBe(204)
    const patch = await request.patch(`${AUTH_API_BASE}/api/ai/settings`, {
      headers: { Authorization: `Bearer ${a}` },
      data: { activeProvider: 'openrouter' },
    })
    expect(patch.status()).toBe(200)

    // A sees its config; the secret is never echoed back.
    const aRes = await request.get(`${AUTH_API_BASE}/api/ai/settings`, {
      headers: { Authorization: `Bearer ${a}` },
    })
    const aBody = (await aRes.json()) as {
      settings: { activeProvider: string }
      statuses: { provider: string; hasKey: boolean }[]
    }
    expect(aBody.settings.activeProvider).toBe('openrouter')
    expect(aBody.statuses.find((s) => s.provider === 'openrouter')?.hasKey).toBe(true)
    expect(JSON.stringify(aBody)).not.toContain('a-openrouter-secret')

    // B sees a pristine config with NO key — strict isolation.
    const bRes = await request.get(`${AUTH_API_BASE}/api/ai/settings`, {
      headers: { Authorization: `Bearer ${b}` },
    })
    const bBody = (await bRes.json()) as {
      settings: { activeProvider: string }
      statuses: { provider: string; hasKey: boolean }[]
    }
    expect(bBody.settings.activeProvider).toBe('anthropic')
    expect(bBody.statuses.find((s) => s.provider === 'openrouter')?.hasKey).toBe(false)
    expect(JSON.stringify(bBody)).not.toContain('a-openrouter-secret')
  })
})
