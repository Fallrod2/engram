import { expect, type Page } from '@playwright/test'

/**
 * Role/name selector helpers shared by the specs (Phase 7 §1.2). Everything is
 * addressed by accessible role + FR name (the app's default locale is `fr`), so
 * the tests need no `data-testid`. Each helper creates uniquely-named entities
 * so specs stay isolated on the single shared run database (workers:1).
 */

/**
 * The content region. Row/entity links are scoped here because a subject also
 * appears as a nav link in the sidebar `<aside>` — the same accessible name in
 * two places would otherwise trip strict mode.
 */
export function content(page: Page) {
  return page.getByRole('main')
}

/** Create a subject from the /subjects screen; returns its name. */
export async function createSubject(page: Page, name: string): Promise<void> {
  // The toolbar button and (when the list is empty) the empty-state button share
  // this name; either opens the create dialog → take the first.
  await page.getByRole('button', { name: 'Nouvelle matière' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('ex. Théorie des langages').fill(name)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog).toBeHidden()
  await expect(content(page).getByRole('link', { name })).toBeVisible()
}

/** Open a subject row by name → lands on /subjects/$id. */
export async function openSubject(page: Page, name: string): Promise<void> {
  await content(page).getByRole('link', { name }).click()
  await expect(page).toHaveURL(/\/subjects\/[^/]+$/)
}

/** Create a deck from the subject detail screen. */
export async function createDeck(page: Page, name: string): Promise<void> {
  // Same duplication as subjects (toolbar + empty-state) → first.
  await page.getByRole('button', { name: 'Nouveau deck' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('ex. Automates finis').fill(name)
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog).toBeHidden()
  await expect(content(page).getByRole('link', { name })).toBeVisible()
}

/** Open a deck row by name → lands on /subjects/$id/decks/$deckId. */
export async function openDeck(page: Page, name: string): Promise<void> {
  await content(page).getByRole('link', { name }).click()
  await expect(page).toHaveURL(/\/decks\/[^/]+$/)
}

/** Add cards through the quick composer (recto/verso + "Ajouter"). */
export async function addCards(page: Page, cards: ReadonlyArray<[string, string]>): Promise<void> {
  const front = page.getByPlaceholder('Question, terme, invite…')
  const back = page.getByPlaceholder('Réponse, définition…')
  const addBtn = page.getByRole('button', { name: 'Ajouter', exact: true })
  await expect(front).toBeVisible()
  for (const [f, b] of cards) {
    const row = page.getByRole('row', { name: new RegExp(escapeRegExp(f)) })
    // No retry: the first submit right after landing on the deck is reliable now
    // that the page transition no longer remounts the route (which discarded the
    // composer's just-typed fields, Phase 7 §4). A dropped first submit here
    // would be a real regression.
    await front.fill(f)
    await back.fill(b)
    await addBtn.click()
    await expect(row).toBeVisible()
  }
  await expect(page.locator('tbody tr')).toHaveCount(cards.length)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Play a full keyboard session, rating every card "Bien" (3). Waits on the
 * observable ASKING→REVEALED transition for each card, then asserts the summary.
 */
export async function reviewAllGood(page: Page, count: number): Promise<void> {
  const revealHint = page.getByText('pour révéler')
  const goodButton = page.getByRole('button', { name: /^Bien/ })
  for (let i = 0; i < count; i++) {
    await expect(revealHint).toBeVisible()
    await page.keyboard.press('Space')
    await expect(goodButton).toBeVisible()
    await page.keyboard.press('3')
  }
  await expect(page.getByText('Session terminée')).toBeVisible()
}
