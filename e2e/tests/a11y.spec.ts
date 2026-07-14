import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { addCards, createDeck, createSubject, openDeck, openSubject } from '../support/selectors'

/**
 * Automated accessibility safety net (Phase 7 §3.5). Two complementary gates:
 *
 *  1. axe-core on the structural/semantic rules it handles reliably —
 *     `heading-order` (the one-<h1>-per-route fix), `aria-required-children`
 *     (grid), `button-name` (icon buttons) and `label` (form controls). Any
 *     violation fails the run.
 *  2. A canvas-measured token contrast gate (`token colour contrast …`) instead
 *     of axe's `color-contrast`. axe-core 4.12's OKLCH→sRGB parser diverges from
 *     Chromium's actual paint by ~1 ratio point on this palette (verified: axe
 *     reported 4.07:1 for `--text-faint` on `--bg`, but the pixel the browser
 *     actually paints measures 5.10:1). Since the whole design system is OKLCH,
 *     gating on axe's contrast would flag false failures; the canvas gate reads
 *     the real painted pixels (the same engine the user sees) and is the accurate
 *     enforcement of the §3.4 contrast table.
 */
const RULES = ['heading-order', 'aria-required-children', 'button-name', 'label'] as const

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules([...RULES]).analyze()
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  )
  expect(summary, `axe violations on ${label}`).toEqual([])
}

test('static section screens have no axe violations', async ({ page }) => {
  for (const [path, ready] of [
    ['/subjects', 'Matières'],
    ['/planning', 'Planning'],
    ['/analytics', 'Analytics'],
    ['/import', 'Import'],
    ['/settings', 'Réglages'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible()
    await expectNoAxeViolations(page, path)
  }
})

test('deck detail with cards has no axe violations', async ({ page }) => {
  const uid = Date.now().toString(36)
  await page.goto('/subjects')
  await createSubject(page, `A11y matiere ${uid}`)
  await openSubject(page, `A11y matiere ${uid}`)
  await createDeck(page, `A11y deck ${uid}`)
  await openDeck(page, `A11y deck ${uid}`)
  await addCards(page, [
    ['Recto a11y 1', 'Verso a11y 1'],
    ['Recto a11y 2', 'Verso a11y 2'],
    ['Recto a11y 3', 'Verso a11y 3'],
  ])
  await expectNoAxeViolations(page, '/subjects/$id/decks/$deckId')
})

test('open review session has no axe violations', async ({ page }) => {
  const uid = Date.now().toString(36)
  await page.goto('/subjects')
  await createSubject(page, `A11y sess ${uid}`)
  await openSubject(page, `A11y sess ${uid}`)
  await createDeck(page, `A11y sess deck ${uid}`)
  await openDeck(page, `A11y sess deck ${uid}`)
  await addCards(page, [['Q session a11y', 'R session a11y']])

  await page.getByRole('button', { name: /^Réviser/ }).click()
  await expect(page).toHaveURL(/\/review/)
  await expect(page.getByText('pour révéler')).toBeVisible()
  await expectNoAxeViolations(page, 'review session (ASKING)')
})

/**
 * Canvas-measured WCAG contrast on the live tokens (both themes). Reads the real
 * `--token` values from `:root`, paints each pair, and asserts the ratio from the
 * actual pixels. Text tokens must clear AA (4.5:1) on every surface; the mandated
 * high-chroma accent/danger FILLS carry near-white foregrounds at AA-large (≥3:1)
 * — their documented button/large-text usage (spec §3.4). This is the accurate
 * enforcement of the §3.4 table and would catch a regression that lowered a
 * token's lightness.
 */
test('token colour contrast meets WCAG (canvas-measured, both themes)', async ({ page }) => {
  await page.goto('/subjects')
  for (const theme of ['dark', 'light'] as const) {
    const failures = await page.evaluate((mode) => {
      document.documentElement.setAttribute('data-theme', mode)
      const cs = getComputedStyle(document.documentElement)
      const v = (name: string) => cs.getPropertyValue(name).trim()

      const c = document.createElement('canvas')
      c.width = c.height = 4
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      const rgb = (css: string): [number, number, number] => {
        ctx.clearRect(0, 0, 4, 4)
        ctx.fillStyle = css
        ctx.fillRect(0, 0, 4, 4)
        const d = ctx.getImageData(1, 1, 1, 1).data
        return [d[0], d[1], d[2]]
      }
      const lin = (x: number) => {
        const s = x / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const lum = ([r, g, b]: [number, number, number]) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const ratio = (a: string, b: string) => {
        const l1 = lum(rgb(a)) + 0.05
        const l2 = lum(rgb(b)) + 0.05
        return Math.max(l1, l2) / Math.min(l1, l2)
      }

      const surfaces = ['--bg', '--surface-1', '--surface-2']
      const text = ['--text', '--text-muted', '--text-faint']
      const fails: string[] = []
      // Text tokens: AA 4.5:1 on every surface.
      for (const t of text) {
        for (const s of surfaces) {
          const r = ratio(v(t), v(s))
          if (r < 4.5) fails.push(`${mode} ${t} on ${s} = ${r.toFixed(2)} (< 4.5)`)
        }
      }
      // Brand fills: near-white fg on accent/danger/success — AA-large 3:1.
      for (const [fg, bg] of [
        ['--accent-fg', '--accent'],
        ['--danger-fg', '--danger'],
        ['--success-fg', '--success'],
      ]) {
        const r = ratio(v(fg), v(bg))
        if (r < 3) fails.push(`${mode} ${fg} on ${bg} = ${r.toFixed(2)} (< 3)`)
      }
      return fails
    }, theme)
    expect(failures, `${theme} token contrast`).toEqual([])
  }
  // Leave the app in its default theme for any later navigation.
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
})
