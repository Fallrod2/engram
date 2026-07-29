import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { onboardingStatusSchema } from '@engram/shared'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { appSettings } from '../db/schema'
import { seedCard, seedDeck, seedSubject } from '../test-support/harness'
import {
  ONBOARDING_DISABLED_ENV,
  ONBOARDING_KEY,
  getOnboardingStatus,
  onboardingDisabled,
  setOnboardingCompleted,
} from './onboarding.service'

let t: TestDb
let db: DB
beforeEach(async () => {
  t = await createTestDb()
  db = t.db
})
afterEach(async () => {
  await t.cleanup()
})

const OTHER = '00000000-0000-4000-8000-0000000000ff'
/** No env in the test process must be able to flip the kill-switch by accident. */
const ENV: Record<string, string | undefined> = {}

const status = (userId = U, isDemo = false, env = ENV) =>
  getOnboardingStatus(db, userId, { isDemo, env })

async function markerRows(userId: string) {
  return db
    .select()
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, ONBOARDING_KEY)))
}

describe('getOnboardingStatus', () => {
  it('is pending, and only pending, for an account with no marker and no content', async () => {
    const s = await status()
    expect(onboardingStatusSchema.parse(s)).toEqual({
      pending: true,
      reason: 'new-account',
      completedAt: null,
    })
  })

  it('is NOT pending for an account that already owns content (the computed backfill)', async () => {
    // This is the answer to "does the journey fall on Alex and the test accounts
    // at their next load?" — no, and without a migration that guesses.
    await seedSubject(db, { userId: U })
    expect(await status()).toEqual({
      pending: false,
      reason: 'existing-account',
      completedAt: null,
    })
  })

  it('counts a card as content even when its subject belongs to somebody else', async () => {
    // The probe is a UNION of three independent per-user predicates, so each root
    // stands on its own — a card is content whatever the shape of the tree above
    // it. Regression guard for a future rewrite into a single join.
    const sub = await seedSubject(db, { userId: OTHER })
    const deck = await seedDeck(db, sub.id, { userId: OTHER })
    await seedCard(db, deck.id, { userId: U })
    expect((await status()).reason).toBe('existing-account')
  })

  it('does not see ANOTHER account’s content', async () => {
    await seedSubject(db, { userId: OTHER })
    expect(await status()).toEqual({ pending: true, reason: 'new-account', completedAt: null })
  })

  it('is completed once a marker exists, content or not', async () => {
    const s = await setOnboardingCompleted(db, U, true, {
      isDemo: false,
      now: new Date('2026-07-29T10:00:00.000Z'),
      env: ENV,
    })
    expect(s).toEqual({
      pending: false,
      reason: 'completed',
      completedAt: '2026-07-29T10:00:00.000Z',
    })
    expect(await status()).toEqual(s)
  })

  it('a corrupt marker blob degrades to "never completed" instead of throwing', async () => {
    // A row hand-edited (or written by a future shape) must not be able to 500
    // the FIRST navigation of a session — this endpoint is on that path.
    await db
      .insert(appSettings)
      .values({ userId: U, key: ONBOARDING_KEY, value: { completedAt: 42 } })
    expect(await status()).toEqual({ pending: true, reason: 'new-account', completedAt: null })
  })
})

describe('the demo account', () => {
  it('is never offered the journey, even with no content at all', async () => {
    expect(await status(U, true)).toEqual({ pending: false, reason: 'demo', completedAt: null })
  })

  it('never writes a marker — a visitor leaves nothing for the next one', async () => {
    const s = await setOnboardingCompleted(db, U, true, { isDemo: true, env: ENV })
    expect(s.reason).toBe('demo')
    expect(await markerRows(U)).toHaveLength(0)
  })
})

describe('the deployment kill-switch', () => {
  it('reads only the exact "1" opt-in', () => {
    expect(onboardingDisabled({})).toBe(false)
    expect(onboardingDisabled({ [ONBOARDING_DISABLED_ENV]: '0' })).toBe(false)
    expect(onboardingDisabled({ [ONBOARDING_DISABLED_ENV]: 'true' })).toBe(false)
    expect(onboardingDisabled({ [ONBOARDING_DISABLED_ENV]: '1' })).toBe(true)
  })

  it('shadows a brand-new account (this is what keeps the e2e suite on its screens)', async () => {
    expect(await status(U, false, { [ONBOARDING_DISABLED_ENV]: '1' })).toEqual({
      pending: false,
      reason: 'disabled',
      completedAt: null,
    })
  })
})

describe('setOnboardingCompleted', () => {
  it('is idempotent — reopening the journey and finishing again is legal', async () => {
    const first = await setOnboardingCompleted(db, U, true, {
      isDemo: false,
      now: new Date('2026-07-29T10:00:00.000Z'),
      env: ENV,
    })
    const second = await setOnboardingCompleted(db, U, true, {
      isDemo: false,
      now: new Date('2026-07-30T11:00:00.000Z'),
      env: ENV,
    })
    expect(first.completedAt).toBe('2026-07-29T10:00:00.000Z')
    expect(second.completedAt).toBe('2026-07-30T11:00:00.000Z')
    expect(await markerRows(U)).toHaveLength(1)
  })

  it('can re-arm the journey (completed: false drops the marker)', async () => {
    await setOnboardingCompleted(db, U, true, { isDemo: false, env: ENV })
    expect(await setOnboardingCompleted(db, U, false, { isDemo: false, env: ENV })).toEqual({
      pending: true,
      reason: 'new-account',
      completedAt: null,
    })
    expect(await markerRows(U)).toHaveLength(0)
  })

  it('leaves the OTHER keys of app_settings alone', async () => {
    await db.insert(appSettings).values({ userId: U, key: 'study', value: { newCardsPerDay: 7 } })
    await setOnboardingCompleted(db, U, true, { isDemo: false, env: ENV })
    await setOnboardingCompleted(db, U, false, { isDemo: false, env: ENV })
    const [study] = await db
      .select()
      .from(appSettings)
      .where(and(eq(appSettings.userId, U), eq(appSettings.key, 'study')))
    expect(study?.value).toEqual({ newCardsPerDay: 7 })
  })
})
