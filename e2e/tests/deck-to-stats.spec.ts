import { test, expect } from '@playwright/test'
import { API_BASE } from '../fixtures/env'
import {
  addCards,
  createDeck,
  createSubject,
  openDeck,
  openSubject,
  reviewAllGood,
} from '../support/selectors'

/**
 * Parcours 1 (CLAUDE.md): create subject → deck → cards → full keyboard review
 * session → verify the reviews landed. Everything is driven by role/name and,
 * for the session, 100% by keyboard (CLAUDE.md: "session 100 % sans souris").
 */

test('subject → deck → cards → keyboard session → analytics', async ({ page, request }) => {
  const uid = Date.now().toString(36)
  const subject = `E2E matiere ${uid}`
  const deck = `E2E deck ${uid}`

  await page.goto('/subjects')

  // 1. Subject.
  await createSubject(page, subject)

  // 2. Open it → empty deck state.
  await openSubject(page, subject)
  await expect(page.getByText('Aucun deck')).toBeVisible()

  // 3. Deck.
  await createDeck(page, deck)

  // 4. Open it → empty card state.
  await openDeck(page, deck)
  await expect(page.getByText('Aucune carte')).toBeVisible()

  // 5. Add 3 cards via the composer.
  await addCards(page, [
    ['Recto un', 'Verso un'],
    ['Recto deux', 'Verso deux'],
    ['Recto trois', 'Verso trois'],
  ])

  // The "Réviser" entry appears with the due counter once cards exist.
  const review = page.getByRole('button', { name: 'Réviser' })
  await expect(review).toBeVisible()

  // 6. Full keyboard session.
  await review.click()
  await expect(page).toHaveURL(/\/review/)
  await reviewAllGood(page, 3)

  // Exit via Enter (confirmExit on the summary) → leaves the session.
  await page.keyboard.press('Enter')
  await expect(page).not.toHaveURL(/\/review/)

  // 7. Verify the reviews were logged (API-level, decoupled from analytics UI).
  const res = await request.get(`${API_BASE}/api/analytics/review-volume`)
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { totals: { total: number } }
  expect(body.totals.total).toBeGreaterThanOrEqual(3)
})

test('an empty deck shows the "all caught up" session state', async ({ page }) => {
  const uid = Date.now().toString(36)
  const subject = `E2E vide ${uid}`
  const deck = `E2E vide deck ${uid}`

  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  await createDeck(page, deck)
  await openDeck(page, deck)

  // Derive the deck id from the URL and enter its (empty) review session.
  const deckId = page.url().split('/decks/')[1]
  expect(deckId).toBeTruthy()
  await page.goto(`/review?deckId=${deckId}`)
  await expect(page.getByText(/Rien à réviser/)).toBeVisible()
})

test('Échap quits an ungraded session', async ({ page }) => {
  const uid = Date.now().toString(36)
  const subject = `E2E echap ${uid}`
  const deck = `E2E echap deck ${uid}`

  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  await createDeck(page, deck)
  await openDeck(page, deck)
  await addCards(page, [['Q échap', 'R échap']])

  await page.getByRole('button', { name: 'Réviser' }).click()
  await expect(page).toHaveURL(/\/review/)
  await expect(page.getByText('pour révéler')).toBeVisible()

  // Nothing graded yet → Escape exits without a confirm dialog.
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/\/review/)
})
