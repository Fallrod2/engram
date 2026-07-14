import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

/**
 * Photo OCR flow (OCR spec §3): drop a real PNG on the importer → it is
 * downscaled IN THE BROWSER (real canvas) → uploaded to
 * `POST /api/notes/extract-image` → the FAKE vision extractor (ENGRAM_FAKE_AI)
 * returns deterministic Markdown → preview/correct → create the note
 * (`sourceType: 'image'`) → the existing generation launch panel is reachable.
 *
 * The fake honours `__E2E_OCR_FAIL__` through the FILENAME (which the client
 * preserves on the downscaled blob), driving the failure branch.
 */

const PHOTO = fileURLToPath(new URL('../fixtures/photo.png', import.meta.url))
const PHOTO_BYTES = readFileSync(PHOTO)

const docPicker = 'input[type="file"]:not([capture])'

test('photo → downscale → OCR preview → correct → create note', async ({ page }) => {
  await page.goto('/import')
  await page.locator(docPicker).setInputFiles(PHOTO)

  // Images take the dedicated preview route (they don't create a note directly).
  await expect(page).toHaveURL(/\/import\/photo/)

  // The fake transcription (deterministic) lands in the editable textarea.
  const textarea = page.getByLabel('Texte transcrit')
  await expect(textarea).toHaveValue(/Transcription factice/)
  // The `[?]` marker surfaces an uncertainty badge.
  await expect(page.getByText(/marqueurs? \[\?\]/)).toBeVisible()

  // Correct the text (a `question :: answer` line the fake generator can parse).
  await textarea.fill('Capitale de la France :: Paris')
  await page.getByRole('button', { name: 'Créer la note' }).click()

  // Landed on the note detail with the existing generation panel available.
  await expect(page).toHaveURL(/\/import\/(?!photo)[^/]+$/)
  await expect(page.getByRole('button', { name: 'Générer' })).toBeVisible()
})

test('a photo whose extraction fails shows the failure state', async ({ page }) => {
  await page.goto('/import')
  await page.locator(docPicker).setInputFiles({
    name: '__E2E_OCR_FAIL__.png',
    mimeType: 'image/png',
    buffer: PHOTO_BYTES,
  })
  await expect(page).toHaveURL(/\/import\/photo/)
  await expect(page.getByText(/Aucune page/)).toBeVisible()
})
