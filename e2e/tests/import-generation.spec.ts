import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { createDeck, createSubject, openSubject, reviewAllGood } from '../support/selectors'

/**
 * Parcours 2 (CLAUDE.md): import a .md → AI generation (fake, deterministic) →
 * keyboard triage (accept / edit / reject) → insert → review the generated
 * cards. Plus the empty/failed generation edge cases, driven by the fake
 * generator's `__E2E_EMPTY__` / `__E2E_FAIL__` sentinels.
 */

const SAMPLE_MD = fileURLToPath(new URL('../fixtures/sample.md', import.meta.url))

/** Create a subject + one deck (the insertion target) from scratch. */
async function setupSubjectDeck(
  page: Page,
  uid: string,
): Promise<{ subject: string; deck: string }> {
  const subject = `E2E import ${uid}`
  const deck = `E2E gen deck ${uid}`
  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  await createDeck(page, deck)
  return { subject, deck }
}

/** On /import, file the uploads under `subject`, then upload one file. */
async function uploadInto(
  page: Page,
  subject: string,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.goto('/import')
  await page.getByRole('combobox', { name: 'Ranger les imports dans une matière' }).click()
  await page.getByRole('option', { name: subject }).click()
  // The doc picker (the camera-capture input also matches `input[type=file]`).
  await page.locator('input[type="file"]:not([capture])').setInputFiles(file)
}

/** Open a note by title and launch a generation into `deck`. */
async function openNoteAndGenerate(page: Page, noteTitle: string, deck: string): Promise<void> {
  await page.getByRole('link', { name: noteTitle }).click()
  await expect(page).toHaveURL(/\/import\/[^/]+$/)
  // Pick the target deck explicitly (the smart default also sets it).
  await page.getByRole('combobox', { name: 'Deck cible' }).click()
  await page.getByRole('option', { name: deck }).click()
  await page.getByRole('button', { name: 'Générer' }).click()
  await expect(page).toHaveURL(/\/generations\/[^/]+$/)
}

test('import → generation → keyboard triage → insert → review', async ({ page }) => {
  const uid = Date.now().toString(36)
  const { subject, deck } = await setupSubjectDeck(page, uid)

  await uploadInto(page, subject, SAMPLE_MD)
  await openNoteAndGenerate(page, 'sample', deck)

  // Poll pending → succeeded: the 3 deterministic proposals appear.
  await expect(page.getByText('Capitale de la France')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(3)

  // Keyboard triage on three distinct cards: accept #1, reject #2, edit #3.
  await page.keyboard.press('a') // accept item 0 → advance
  await page.keyboard.press('r') // reject item 1 → advance
  await page.keyboard.press('e') // edit item 2
  const recto = page.getByLabel('Recto')
  await expect(recto).toBeVisible()
  await recto.fill('Recto édité e2e')
  await page.keyboard.press('ControlOrMeta+Enter') // save the edit (stays local)
  await expect(recto).toBeHidden()

  // toInsert = accepted(1) + edited(1) = 2.
  const insertBar = page.getByRole('button', { name: /Insérer 2 cartes/ })
  await expect(insertBar).toBeVisible()

  // Open the confirm via ⌘↵, then confirm.
  await page.keyboard.press('ControlOrMeta+Enter')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Insérer', exact: true }).click()

  // Resolved banner (persistent, unlike the toast).
  await expect(page.getByText(/2 cartes insérées/)).toBeVisible()

  // Review the freshly inserted cards.
  await page.getByRole('link', { name: 'Réviser maintenant' }).click()
  await expect(page).toHaveURL(/\/review/)
  await reviewAllGood(page, 2)
})

test('mixed generation → badges → accept all → materialised cloze cards land in the deck', async ({
  page,
}) => {
  const uid = Date.now().toString(36)
  const { subject, deck } = await setupSubjectDeck(page, uid)

  // Unique note name: the suite shares one DB, so 'sample' would collide with the
  // first test's upload. The fake mixed generator ignores the content.
  const noteName = `mixed-${uid}`
  await uploadInto(page, subject, {
    name: `${noteName}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Mixte\n\nContenu de cours pour le mode mixte.\n'),
  })

  // Open the note, switch to the "Mixte (auto)" tab, pick the deck, generate.
  await page.getByRole('link', { name: noteName }).click()
  await expect(page).toHaveURL(/\/import\/[^/]+$/)
  await page.getByRole('tab', { name: 'Mixte (auto)' }).click()
  await page.getByRole('combobox', { name: 'Deck cible' }).click()
  await page.getByRole('option', { name: deck }).click()
  await page.getByRole('button', { name: 'Générer' }).click()
  await expect(page).toHaveURL(/\/generations\/[^/]+$/)

  // The fake mixed generator emits 2 Q/R + a 2-mask cloze; the server expands
  // the cloze into 2 cards → 4 materialised proposals.
  await expect(page.locator('article')).toHaveCount(4)
  // Evaluation badges from the mixed mode.
  await expect(page.getByText('Cloze').first()).toBeVisible()
  await expect(page.getByText('Q/R').first()).toBeVisible()
  // A materialised cloze recto shows the blank placeholder ([…]).
  await expect(page.getByText('[…]').first()).toBeVisible()

  // Accept every proposal (Shift+A), then insert the 4.
  await page.keyboard.press('Shift+A')
  await expect(page.getByRole('button', { name: /Insérer 4 cartes/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Enter')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Insérer', exact: true }).click()

  await expect(page.getByText(/4 cartes insérées/)).toBeVisible()

  // The freshly inserted cards (including the 2 cloze-derived ones) are reviewable.
  await page.getByRole('link', { name: 'Réviser maintenant' }).click()
  await expect(page).toHaveURL(/\/review/)
  await reviewAllGood(page, 4)
})

test('empty generation shows the "no cards" state', async ({ page }) => {
  const uid = Date.now().toString(36)
  const { subject, deck } = await setupSubjectDeck(page, uid)

  await uploadInto(page, subject, {
    name: 'empty-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Vide\n\n__E2E_EMPTY__\n'),
  })
  await openNoteAndGenerate(page, 'empty-note', deck)

  await expect(page.getByText('Aucune carte proposée')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Relancer' })).toBeVisible()
})

test('failed generation shows the error state', async ({ page }) => {
  const uid = Date.now().toString(36)
  const { subject, deck } = await setupSubjectDeck(page, uid)

  await uploadInto(page, subject, {
    name: 'fail-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Échec\n\n__E2E_FAIL__\n'),
  })
  await openNoteAndGenerate(page, 'fail-note', deck)

  await expect(page.getByText('La génération a échoué')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Relancer la génération' })).toBeVisible()
})
