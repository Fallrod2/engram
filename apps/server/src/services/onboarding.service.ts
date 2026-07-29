import { and, eq, sql } from 'drizzle-orm'
import { unionAll } from 'drizzle-orm/pg-core'
import type { OnboardingStatus } from '@engram/shared'
import type { DB, Tx } from '../db/client'
import { appSettings, card, note, subject } from '../db/schema'

/**
 * The first-run journey's marker (T-049). Three steps live in the browser —
 * language/theme, study pace, AI — but the answer to "has this account already
 * been offered the journey?" is SERVER-SIDE, and that is the whole point: in
 * `localStorage` the journey would come back on every new browser, every private
 * window and every device, which is precisely the nagging Alex ruled out.
 *
 * WHERE IT IS STORED, AND WHY THERE IS NO MIGRATION. Under the `'onboarding'`
 * key of `app_settings`, next to `'ai'`, `'study'` and `'demo'` — the per-user
 * non-secret k/v store. That table is already keyed `(user_id, key)`, already
 * carries its RLS policy (migration 0006) and is already purged by the
 * account-delete path (`admin.service.ts`), so a one-boolean-per-account marker
 * lands there with zero DDL. A dedicated column on `user_profile` would have put
 * a UI preference inside the IAM record that every authenticated request reads.
 *
 * ═══ THE BACKFILL IS COMPUTED, NOT WRITTEN ═══
 *
 * Accounts that existed before this shipped carry no marker, and a marker cannot
 * be back-filled without inventing a migration that guesses. So "existing
 * account" is DERIVED: an account that already owns a subject, a card or a note
 * has evidently used the product, and is never redirected into a first-run
 * journey. Alex's account and the test accounts therefore see nothing change on
 * their next load — which is the answer to "does this fall on existing users?".
 *
 * That derivation is deliberately NOT persisted. Writing it on a GET would be a
 * write-on-read, the exact defect `lib/theme.tsx` and `lib/i18n` were fixed for
 * a day earlier ("mounting is not choosing"). The cost of not persisting is one
 * cheap EXISTS per status read, and one honest consequence: an account that
 * empties itself completely, having never gone through the journey, will be
 * offered it. That is the correct behaviour, not a leak.
 */

/** The single `app_settings` key holding the journey marker. */
export const ONBOARDING_KEY = 'onboarding'

/**
 * Kill-switch for deployments that must never be redirected into the journey.
 *
 * It exists for ONE caller: the Playwright suites. They run against a database
 * created empty seconds earlier, under the auth bypass, so every single spec
 * would open on a brand-new account with no content — i.e. `pending: true` — and
 * be redirected out of the screen it came to test. Explicit and env-driven, like
 * `ENGRAM_FAKE_AI` next to it in `playwright.config.ts`, rather than a heuristic
 * ("no auth ⇒ no journey") that would also silence it in local dev, where seeing
 * the journey fire is the only way to verify it.
 */
export const ONBOARDING_DISABLED_ENV = 'ENGRAM_ONBOARDING_DISABLED'

export function onboardingDisabled(env: Record<string, string | undefined>): boolean {
  return env[ONBOARDING_DISABLED_ENV] === '1'
}

/** Shape of the stored blob. Anything else reads as "no marker". */
interface OnboardingMarker {
  completedAt: string
}

/**
 * The stored marker, or `null`. Tolerant like every other reader of this table:
 * a hand-edited or legacy blob degrades to "never completed" instead of throwing
 * — a corrupt row must not be able to 500 the first navigation of a session.
 */
async function readMarker(db: DB | Tx, userId: string): Promise<OnboardingMarker | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, ONBOARDING_KEY)))
  const v = row?.value as { completedAt?: unknown } | undefined
  if (!v || typeof v !== 'object') return null
  return typeof v.completedAt === 'string' ? { completedAt: v.completedAt } : null
}

/**
 * Does this account own anything at all? ONE statement — a `UNION ALL` of three
 * `LIMIT 1` probes — rather than three round-trips, because this runs on the
 * first navigation of every session and the deployment pays ~15 ms per round
 * trip to its database.
 *
 * `subject` / `card` / `note` are the three ROOTS a user can create first: a
 * deck needs a subject, a review needs a card, a generation needs a note. So
 * covering the three covers every way of having started using engram. All three
 * predicates hit the `user_id` index the row scoping already requires.
 */
async function hasContent(db: DB | Tx, userId: string): Promise<boolean> {
  const one = sql<number>`1`
  const rows = await unionAll(
    db.select({ n: one }).from(subject).where(eq(subject.userId, userId)).limit(1),
    db.select({ n: one }).from(card).where(eq(card.userId, userId)).limit(1),
    db.select({ n: one }).from(note).where(eq(note.userId, userId)).limit(1),
  ).limit(1)
  return rows.length > 0
}

/**
 * Should the app open the journey by itself for `userId`?
 *
 * The order of the tests IS the specification, and each one shadows the ones
 * below it on purpose:
 *
 *  1. the deployment turned the journey off → never.
 *  2. the caller is the demo account → never. A visitor must land in the product
 *     with its data, not in a settings wizard; and since the demo account is
 *     SHARED, anything the journey persisted would be the next visitor's problem
 *     (`demo.service.ts` wipes those keys on every reseed for the same reason).
 *  3. an explicit marker → completed, whatever else is true. This is the only
 *     value the user actually authored.
 *  4. the account already owns content → it predates the journey. Not pending.
 *  5. otherwise → a genuinely new account, and the one case that is pending.
 */
export async function getOnboardingStatus(
  db: DB,
  userId: string,
  opts: { isDemo: boolean; env?: Record<string, string | undefined> },
): Promise<OnboardingStatus> {
  if (onboardingDisabled(opts.env ?? process.env)) {
    return { pending: false, reason: 'disabled', completedAt: null }
  }
  if (opts.isDemo) return { pending: false, reason: 'demo', completedAt: null }
  const marker = await readMarker(db, userId)
  if (marker) return { pending: false, reason: 'completed', completedAt: marker.completedAt }
  if (await hasContent(db, userId)) {
    return { pending: false, reason: 'existing-account', completedAt: null }
  }
  return { pending: true, reason: 'new-account', completedAt: null }
}

/**
 * Record (or clear) the marker, then re-read the status so the caller always
 * gets the same projection a GET would give — including the demo/disabled
 * shadowing, which a hand-built response would have to duplicate.
 *
 * THE DEMO NEVER WRITES. A visitor who opens the journey from the demo account's
 * settings and finishes it must leave no trace: the next visitor gets the same
 * account, and the reseed only runs on a NEW session. Making the write a no-op
 * here is the guarantee that does not depend on the reseed catching up.
 */
export async function setOnboardingCompleted(
  db: DB,
  userId: string,
  completed: boolean,
  opts: { isDemo: boolean; now?: Date; env?: Record<string, string | undefined> },
): Promise<OnboardingStatus> {
  if (!opts.isDemo) {
    if (completed) {
      const value: OnboardingMarker = { completedAt: (opts.now ?? new Date()).toISOString() }
      await db
        .insert(appSettings)
        .values({ userId, key: ONBOARDING_KEY, value })
        .onConflictDoUpdate({
          target: [appSettings.userId, appSettings.key],
          set: { value, updatedAt: new Date() },
        })
    } else {
      await db
        .delete(appSettings)
        .where(and(eq(appSettings.userId, userId), eq(appSettings.key, ONBOARDING_KEY)))
    }
  }
  return getOnboardingStatus(db, userId, opts)
}
