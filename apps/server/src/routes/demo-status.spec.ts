import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { demoSeedStatusResponseSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { subject } from '../db/schema'
import { resetDb } from '../test-support/harness'
import { isPublicRoute } from '../http/auth'

/**
 * `GET /api/demo/status` — the probe the landing's initialization window polls.
 * Same harness as `demo-reset.spec.ts`: pointing `ENGRAM_DEV_USER_ID` and
 * `ENGRAM_DEMO_USER_ID` at the same id makes the default bypass caller the demo
 * account. Bypass tokens carry no `session_id`, so the marker is `'no-session'`.
 *
 * What this pins, in order of how badly each would hurt:
 *  1. polling NEVER seeds (else the probe restarts the work it observes);
 *  2. the route is NOT public and NOT open to non-demo callers;
 *  3. the reported state actually tracks the seed.
 */

const DEMO = 'demo-user'
const PREV_DEMO = process.env.ENGRAM_DEMO_USER_ID
const PREV_DEV = process.env.ENGRAM_DEV_USER_ID

beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  if (PREV_DEMO === undefined) delete process.env.ENGRAM_DEMO_USER_ID
  else process.env.ENGRAM_DEMO_USER_ID = PREV_DEMO
  if (PREV_DEV === undefined) delete process.env.ENGRAM_DEV_USER_ID
  else process.env.ENGRAM_DEV_USER_ID = PREV_DEV
})

function enableDemo(): void {
  process.env.ENGRAM_DEMO_USER_ID = DEMO
  process.env.ENGRAM_DEV_USER_ID = DEMO
}

async function status(): Promise<{ res: Response; body: unknown }> {
  const res = await app.request('/api/demo/status')
  return { res, body: await res.json() }
}

const countSubjects = async (): Promise<number> =>
  ((await (await app.request('/api/subjects')).json()) as unknown[]).length

describe('GET /api/demo/status', () => {
  it('is NOT part of the public-route allowlist', () => {
    // The demo's public surface is exactly one route. This one is authenticated.
    expect(isPublicRoute('GET', '/api/demo/status')).toBe(false)
  })

  it('403s a caller who is not the demo account', async () => {
    // No ENGRAM_DEMO_USER_ID → the bypass identity is a plain user.
    const { res, body } = await status()
    expect(res.status).toBe(403)
    expect((body as { error: { code: string } }).error.code).toBe('forbidden')
  })

  it('reports pending before anything has been seeded', async () => {
    enableDemo()
    const { res, body } = await status()
    expect(res.status).toBe(200)
    expect(demoSeedStatusResponseSchema.parse(body)).toEqual({ state: 'pending', readyAt: null })
  })

  it('polling it never triggers a seed', async () => {
    enableDemo()
    for (let i = 0; i < 3; i++) await status()
    // Read the table directly: going through /api/subjects would itself seed.
    expect((await db.select().from(subject)).length).toBe(0)
    // …and the very next non-status request does seed, so the account is not
    // simply broken: the exemption is scoped to this one route.
    expect(await countSubjects()).toBe(2)
  })

  it('reports ready once a normal request has seeded the session', async () => {
    enableDemo()
    expect(((await status()).body as { state: string }).state).toBe('pending')
    await countSubjects() // first non-status request → seeds
    const { body } = await status()
    const parsed = demoSeedStatusResponseSchema.parse(body)
    expect(parsed.state).toBe('ready')
    expect(parsed.readyAt).not.toBeNull()
  })
})
