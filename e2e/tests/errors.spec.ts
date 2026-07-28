import { test, expect, type Page } from '@playwright/test'
import { API_BASE } from '../fixtures/env'
import { createDeck, createSubject, openSubject } from '../support/selectors'

/** Key error paths (Phase 7 §1.8). */

test('no AI provider configured → 503 → provider banner in the launch panel', async ({ page }) => {
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
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
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

  await expect(page.getByText('Aucun provider IA configuré')).toBeVisible()
})

test('unsupported upload type → toast', async ({ page }) => {
  await page.goto('/import')
  // Images (.png/.jpg/.webp) are now a supported PHOTO flow, so use a genuinely
  // unsupported extension to exercise the rejection toast.
  await page.locator('input[type="file"]:not([capture])').setInputFiles({
    name: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  })
  await expect(page.getByText('Type de fichier non supporté')).toBeVisible()
})

/* -------------------------------------------------------- gone entities -- */

/**
 * T-028 (a). A detail route whose entity is gone must reach its "n'existe plus"
 * screen; it used to sit on the loading skeleton because a 404 was replayed like
 * a transient failure, and between two attempts `@tanstack/query-core` pauses
 * the retryer (hidden tab / offline) with no deadline — the route `loader` then
 * never settles and the router stays `pending` forever.
 *
 * So each case asserts BOTH halves of the contract:
 *   1. the screen says the entity is gone, and offers the way back;
 *   2. the endpoint was called EXACTLY ONCE. This is the discriminator: under
 *      the old `retry: 2` the message only appeared after the third attempt, so
 *      a regression shows up as a count of 3, not as a timeout.
 *
 * Two id SHAPES are exercised where it is cheap. The `id` columns are `text`
 * (apps/server/src/db/schema/columns.ts), so a malformed id and a well-formed
 * but unknown UUID both produce the SAME `404 not_found` — verified against the
 * API, not assumed. Only the second is what a stale bookmark on a deleted deck
 * actually looks like, which is the case reported from production, so it is
 * spelled out rather than left implied by the malformed one.
 */
const UNKNOWN_UUID = '11111111-1111-1111-1111-111111111111'
const UNKNOWN_UUID_2 = '22222222-2222-2222-2222-222222222222'

/** Count requests to one endpoint, letting them through untouched. */
async function countRequests(page: Page, urlGlob: string): Promise<() => number> {
  let calls = 0
  await page.route(urlGlob, (route) => {
    calls += 1
    return route.continue()
  })
  return () => calls
}

for (const [shape, subjectId] of [
  ['malformed id', 'does-not-exist'],
  ['well-formed but unknown uuid', UNKNOWN_UUID],
] as const) {
  test(`unknown subject (${shape}) → "n'existe plus", fetched once`, async ({ page }) => {
    const calls = await countRequests(page, `**/api/subjects/${subjectId}`)
    await page.goto(`/subjects/${subjectId}`)
    await expect(page.getByText('Cette matière n’existe plus.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Retour aux matières' })).toBeVisible()
    expect(calls()).toBe(1)
  })
}

test('unknown deck under a REAL subject → "n\'existe plus", fetched once', async ({ page }) => {
  // A real subject isolates the 404 on the deck alone — with `/subjects/nope/...`
  // the subject 404s too and the assertion would pass without the deck route
  // ever being exercised.
  const subject = `E2E gone ${Date.now().toString(36)}`
  await page.goto('/subjects')
  await createSubject(page, subject)
  await openSubject(page, subject)
  const subjectId = new URL(page.url()).pathname.split('/')[2]!

  const calls = await countRequests(page, `**/api/decks/${UNKNOWN_UUID}`)
  await page.goto(`/subjects/${subjectId}/decks/${UNKNOWN_UUID}`)
  await expect(page.getByText('Ce deck n’existe plus.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour à la matière' })).toBeVisible()
  expect(calls()).toBe(1)
})

test('unknown note → "n\'existe plus", fetched once', async ({ page }) => {
  const calls = await countRequests(page, `**/api/notes/${UNKNOWN_UUID}`)
  await page.goto(`/import/${UNKNOWN_UUID}`)
  await expect(page.getByText('Cette note n’existe plus.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour à l’import' })).toBeVisible()
  expect(calls()).toBe(1)
})

test('unknown generation → "n\'existe plus", fetched once', async ({ page }) => {
  const calls = await countRequests(page, `**/api/generations/${UNKNOWN_UUID_2}`)
  await page.goto(`/import/${UNKNOWN_UUID}/generations/${UNKNOWN_UUID_2}`)
  await expect(page.getByText('Cette génération n’existe plus.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour à la note' })).toBeVisible()
  expect(calls()).toBe(1)
})

/**
 * T-028 (b). An unmatched URL used to render the router's bare, untranslated
 * "Not Found" with no exit and the page titled "engram".
 */
test('unmatched URL → translated 404 screen with a way back', async ({ page }) => {
  await page.goto('/this/page/does-not-exist')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Cette page n’existe pas.' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Retour au tableau de bord' })).toBeVisible()
  await expect(page).toHaveTitle('Page introuvable · engram')
  await expect(page.getByText('Not Found', { exact: true })).toHaveCount(0)
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
