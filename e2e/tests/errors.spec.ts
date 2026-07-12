import { test, expect } from '@playwright/test'
import { API_BASE } from '../fixtures/env'
import { createDeck, createSubject, openSubject } from '../support/selectors'

/** Key error paths (Phase 7 §1.8). */

test('missing Anthropic key → 503 → ApiKeyMissingBanner in the launch panel', async ({ page }) => {
  const uid = Date.now().toString(36)
  const subject = `E2E err ${uid}`
  const deck = `E2E err deck ${uid}`

  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  await createDeck(page, deck)

  // Import a note under the subject.
  await page.goto('/import')
  await page.getByRole('combobox', { name: 'Ranger les imports dans une matière' }).click()
  await page.getByRole('option', { name: subject }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'key-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('Q :: R\n'),
  })
  await page.getByRole('link', { name: 'key-note' }).click()

  // Force the POST /api/generations to 503 (as a keyless server would), but let
  // every other /api/generations call (the GET list/poll) pass through.
  await page.route('**/api/generations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'service_unavailable', message: 'AI generation unavailable' },
      }),
    })
  })

  await page.getByRole('combobox', { name: 'Deck cible' }).click()
  await page.getByRole('option', { name: deck }).click()
  await page.getByRole('button', { name: 'Générer' }).click()

  await expect(page.getByText('Clé API Anthropic manquante')).toBeVisible()
})

test('unsupported upload type → toast', async ({ page }) => {
  await page.goto('/import')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'image.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  })
  await expect(page.getByText('Type de fichier non supporté')).toBeVisible()
})

test('unknown subject → subject ErrorState', async ({ page }) => {
  await page.goto('/subjects/does-not-exist')
  await expect(page.getByText('Impossible de charger cette matière.')).toBeVisible()
})

test('unknown deck → deck ErrorState', async ({ page }) => {
  await page.goto('/subjects/nope/decks/nope')
  await expect(page.getByText('Impossible de charger ce deck.')).toBeVisible()
})

test('upload API rejects a non-md/pdf binary with 400 validation_error', async ({ request }) => {
  const res = await request.post(`${API_BASE}/api/notes/upload`, {
    multipart: {
      file: {
        name: 'blob.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from([0x00, 0x01, 0x02, 0x03]),
      },
    },
  })
  expect(res.status()).toBe(400)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe('validation_error')
})
