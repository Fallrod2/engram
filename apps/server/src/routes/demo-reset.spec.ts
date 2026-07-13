import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb } from '../test-support/harness'

/**
 * Demo-reset middleware (spec §4 / §6.4) via `app.request`. The bypass identity's
 * `sub` is `ENGRAM_DEV_USER_ID`; pointing that AND `ENGRAM_DEMO_USER_ID` at the
 * same id makes the default caller the demo user. Bypass tokens carry no
 * `session_id`, so the marker is `'no-session'`: seeded on the first pass, never
 * re-wiped afterwards (idempotent within the "session"). The real session-change
 * wipe path is covered deterministically in `demo.service.spec.ts` and end-to-end
 * in the auth e2e.
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
  process.env.ENGRAM_DEV_USER_ID = DEMO // default bypass identity becomes the demo user
}

const listSubjects = async (): Promise<{ id: string; name: string }[]> =>
  (await (await app.request('/api/subjects')).json()) as { id: string; name: string }[]

describe('demo reset middleware', () => {
  it('seeds on the first demo request', async () => {
    enableDemo()
    const list = await listSubjects()
    expect(list.length).toBe(2)
    expect(list.map((s) => s.name)).toContain('Anglais')
  })

  it('does NOT re-wipe on a later request of the same session', async () => {
    enableDemo()
    const first = await listSubjects()
    const target = first[0]!
    // A user edit that a spurious reset would erase.
    await app.request(`/api/subjects/${target.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'EDITED' }),
    })
    const second = await listSubjects()
    expect(second.length).toBe(2)
    expect(second.find((s) => s.id === target.id)?.name).toBe('EDITED')
  })

  it('does nothing when no demo account is configured', async () => {
    // ENGRAM_DEMO_USER_ID unset → the fresh db stays empty.
    const list = await listSubjects()
    expect(list.length).toBe(0)
  })
})
