import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE } from '../fixtures/env'
import { addCards, createDeck, createSubject, openDeck, openSubject } from '../support/selectors'

/**
 * T-014 — end-to-end proof that `U` (undo the last rating) does NOT double-count
 * the analytics.
 *
 * The point of this spec is its LAST assertion, not the button: a rating that is
 * taken back has to vanish from `review_log`, because `review_log` is the raw
 * material of every analytic (`analytics.service.ts` reads it directly, with no
 * join). Three cards graded + one undo + one re-grade must therefore read as
 * THREE reviews, never four.
 *
 * The whole run shares ONE throwaway database (`playwright.config.ts`,
 * `workers: 1`) and `/api/analytics/review-volume` is scoped by user + time
 * window only — it has no deck/subject filter. So the counts are read as a DELTA
 * around the session rather than as an absolute: correct here, and immune to
 * whatever the other specs wrote before us. The auth gate is off for this suite
 * (`ENGRAM_AUTH_DISABLED=1`), so `request` and the browser share the one default
 * dev identity — the very user the session grades under.
 */

interface RatingTotals {
  again: number
  hard: number
  good: number
  easy: number
  total: number
}

async function reviewVolumeTotals(request: APIRequestContext): Promise<RatingTotals> {
  const res = await request.get(`${API_BASE}/api/analytics/review-volume`)
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { totals: RatingTotals }
  return body.totals
}

/**
 * The session header's `done / total` counter, e.g. "1/3". Scoped through the
 * session's own exit button because the app shell keeps a `<header>` of its own
 * in the DOM behind the full-screen portal.
 */
function progressCounter(page: Page) {
  return page
    .locator('header')
    .filter({ has: page.getByRole('button', { name: 'Quitter la session (Échap)' }) })
    .getByText(/^\d+\/\d+$/)
}

test('U takes back the last rating and the review stops being counted', async ({
  page,
  request,
}) => {
  const uid = Date.now().toString(36)
  const subject = `E2E undo ${uid}`
  const deck = `E2E undo deck ${uid}`

  // Verso keyed by recto. The queue is shuffled (`orderQueue`), so the spec must
  // not assume which card comes up first: it reads the recto off the screen and
  // looks the expected verso up here.
  const backOf = new Map([
    ['Recto undo un', 'Verso undo un'],
    ['Recto undo deux', 'Verso undo deux'],
    ['Recto undo trois', 'Verso undo trois'],
  ])

  // 1. Seed: subject → deck → 3 due cards. Same path as deck-to-stats.spec.ts —
  // a brand-new card is `new`, hence due immediately.
  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  await createDeck(page, deck)
  await openDeck(page, deck)
  await addCards(page, [...backOf])

  // Baseline taken after the seeding and right before the session, so the delta
  // below holds this session's reviews and nothing else.
  const before = await reviewVolumeTotals(request)

  // 2. Enter the session and grade the first card "Bien" (3).
  await page.getByRole('button', { name: /^Réviser/ }).click()
  await expect(page).toHaveURL(/\/review/)

  const card = page.locator('article[data-revealed]')
  const question = card.locator('[data-slot="question"]')
  const answer = card.locator('[data-slot="answer"]')
  const revealHint = page.getByText('pour révéler')
  // T-047 — the revealed plain card offers the two verdicts; `J'ai eu juste` is
  // the one that records grade 3. The `3` and `2` keystrokes below are unchanged
  // and deliberately so: the four levels stay live without being on screen, and
  // step 5 grading with a bare `2` is now the e2e proof of it.
  const goodButton = page.getByRole('button', { name: /^J’ai eu juste/ })
  const undoButton = page.getByRole('button', { name: 'Annuler la dernière note (U)' })
  const counter = progressCounter(page)

  await expect(revealHint).toBeVisible()
  await expect(counter).toHaveText('1/3')
  const firstFront = (await question.innerText()).trim()
  expect(backOf.has(firstFront)).toBe(true)

  await page.keyboard.press('Space')
  await expect(goodButton).toBeVisible()
  await page.keyboard.press('3')

  // The undo affordance only arms on RATE_OK, i.e. once the server has ACKed the
  // review and handed back its `review_log` id. Waiting on it — rather than on a
  // duration — is what makes the `U` below land in a defined state.
  await expect(undoButton).toBeVisible()
  await expect(counter).toHaveText('2/3')

  // 3. Undo.
  await page.keyboard.press('u')

  // 4. The session rewinds onto the graded card, REVEALED: the user has already
  // seen the answer, so the card comes back with the answer on screen (UNDO_OK
  // lands on REVEALED, never on ASKING — `session-reducer.ts`). And there is
  // nothing left to take back, so the affordance goes away — a disappearance that
  // only happens on the server's 200, which makes it the sync point for "the log
  // really is gone".
  await expect(undoButton).toBeHidden()
  await expect(counter).toHaveText('1/3')
  await expect(question).toHaveText(firstFront)
  await expect(card).toHaveAttribute('data-revealed', 'true')
  await expect(answer).toHaveText(backOf.get(firstFront) as string)
  await expect(revealHint).toBeHidden()

  // 5. Re-grade the SAME card, this time "Difficile" (2). A different grade from
  // the one undone on purpose: the per-rating deltas asserted at the end then
  // separate "the log was replaced" from "the log was kept" — a surviving row
  // shows up as an extra `good`, not merely as a bigger total.
  await page.keyboard.press('2')
  await expect(counter).toHaveText('2/3')

  // 6. Finish the two remaining cards with "Bien" (3).
  for (let i = 0; i < 2; i++) {
    await expect(revealHint).toBeVisible()
    await page.keyboard.press('Space')
    await expect(goodButton).toBeVisible()
    await page.keyboard.press('3')
  }
  await expect(page.getByText('Session terminée')).toBeVisible()

  // The summary counts three cards, distributed 1 "Difficile" / 2 "Bien" — the
  // client-side mirror of the server-side assertion that follows. (Each entry of
  // the distribution row is a `<span>label<span>count</span></span>`, hence the
  // concatenated text.)
  await expect(page.getByText('cartes vues')).toBeVisible()
  await expect(page.getByText(/^Difficile1$/)).toBeVisible()
  await expect(page.getByText(/^Bien2$/)).toBeVisible()

  // 7. THE assertion. Three cards graded, one rating undone → three reviews in
  // `review_log`, not four. `expect.poll` because the summary is reached on the
  // client the instant the last RATE_OK lands; each turn issues a fresh request,
  // so this only absorbs that lag — it can never mask a wrong count.
  await expect
    .poll(async () => {
      const after = await reviewVolumeTotals(request)
      return {
        total: after.total - before.total,
        good: after.good - before.good,
        hard: after.hard - before.hard,
      }
    })
    .toEqual({ total: 3, good: 2, hard: 1 })
})
