import { beforeEach, describe, expect, it } from 'bun:test'
import { onboardingStatusSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { resetDb, seedSubject, seedUserProfile } from '../test-support/harness'

beforeEach(() => resetDb(db))

const get = () => app.request('/api/onboarding')
const patch = (body: unknown) =>
  app.request('/api/onboarding', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function body(res: Response) {
  return onboardingStatusSchema.parse(await res.json())
}

describe('/api/onboarding', () => {
  it('GET → 200 contract-valid, pending for a brand-new account', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ pending: true, reason: 'new-account', completedAt: null })
  })

  it('PATCH completed → 200, and GET reads the marker back', async () => {
    const res = await patch({ completed: true })
    expect(res.status).toBe(200)
    const patched = await body(res)
    expect(patched.pending).toBe(false)
    expect(patched.reason).toBe('completed')
    expect(patched.completedAt).not.toBeNull()
    expect(await body(await get())).toEqual(patched)
  })

  it('PATCH with a bad body → 400', async () => {
    expect((await patch({})).status).toBe(400)
    expect((await patch({ completed: 'yes' })).status).toBe(400)
  })

  it('an account that already has content is never pending', async () => {
    await seedSubject(db)
    expect((await body(await get())).reason).toBe('existing-account')
  })

  it('the demo account is never pending and never stores a marker', async () => {
    // `is_demo` on the profile is one of the two ways the server recognises the
    // demo (the other is ENGRAM_DEMO_USER_ID); the middleware re-reads the row on
    // every request, so seeding it is enough.
    await seedUserProfile(db, { userId: U, isDemo: true })
    expect(await body(await get())).toEqual({ pending: false, reason: 'demo', completedAt: null })

    const patched = await body(await patch({ completed: true }))
    expect(patched).toEqual({ pending: false, reason: 'demo', completedAt: null })
    // And the next visitor sees exactly the same thing.
    expect(await body(await get())).toEqual({ pending: false, reason: 'demo', completedAt: null })
  })
})
