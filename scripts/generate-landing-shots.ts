/**
 * Reproducible landing product-capture generator (finding: captures were stale —
 * old indigo, FR shots on the EN landing, an impossible "rating buttons without a
 * revealed answer" review state). Regenerates `apps/web/public/landing/*.webp`
 * from the CURRENT UI against a deterministic seeded stack.
 *
 * Localization: each product screen is captured in FOUR variants — theme (dark ×
 * light) × language (fr × en) — written as `<screen>-<theme>-<lang>.webp`, so the
 * EN landing shows EN app chrome instead of reusing the FR shots (`ThemedShot`
 * keys on both theme and language). Card *content* stays French — it is seeded
 * user data — only the UI chrome localizes. It also regenerates the social card
 * `og.png` (the landing hero at the declared 1200×630) so every asset the landing
 * ships is script-reproducible. Re-run after any material UI change.
 *
 * Isolation: a throwaway `engram_fixlandingpolish_*` database on the LOCAL
 * Supabase Postgres (127.0.0.1:54322) — created + migrated + dropped here, never
 * touching the shared `postgres` db. Dev ports 3004 (API) / 5176 (web), never the
 * 3001/5173 dev or 3100/3110 e2e ranges. Everything is torn down in `finally`.
 *
 *   bun scripts/generate-landing-shots.ts            # product captures + og + verify shots
 *   bun scripts/generate-landing-shots.ts --verify   # only the before/after verify shots
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { chromium, type Page } from '@playwright/test'
import { buildSeedBackup } from './landing-seed'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const API_PORT = 3004
const WEB_PORT = 5176
const API = `http://localhost:${API_PORT}`
const WEB = `http://localhost:${WEB_PORT}`
const ADMIN_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const DB_NAME = `engram_fixlandingpolish_${Date.now()}`
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:54322/${DB_NAME}`

const LANDING_DIR = `${ROOT}apps/web/public/landing`
const VERIFY_DIR =
  '/private/tmp/claude-501/-Users-alexabriel-Projects-engram/339eb1d1-25f1-43d2-8fb6-13e6885f02f6/scratchpad/ux-fixes/fix-landing-polish'

const verifyOnly = process.argv.includes('--verify')

function sh(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string) {
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, cwd })
}

async function waitFor(url: string, label: string, timeoutMs = 120_000) {
  const start = Date.now()
  for (;;) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label} (${url})`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

function toWebp(png: string, webp: string) {
  execFileSync('cwebp', ['-quiet', '-q', '90', png, '-o', webp])
  rmSync(png, { force: true })
}

/** Screenshot the current page to `<LANDING_DIR>/<name>.webp` (via a temp PNG). */
async function shot(page: Page, name: string) {
  const png = `${LANDING_DIR}/${name}.png`
  await page.screenshot({ path: png })
  toWebp(png, `${LANDING_DIR}/${name}.webp`)
}

/** Set theme + language before any app script runs, and skip onboarding. */
async function primeContext(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(
    ([th, lg]) => {
      localStorage.setItem('engram-theme', th)
      localStorage.setItem('engram-lang', lg)
      localStorage.setItem('engram-onboarding-dismissed', '1')
    },
    [theme, lang] as const,
  )
}

async function main() {
  let server: ChildProcess | undefined
  let web: ChildProcess | undefined
  const admin = postgres(ADMIN_URL, { max: 1 })

  try {
    // 1. Throwaway DB + migrate (reuse the real migrator for zero schema drift).
    console.log(`[db] create ${DB_NAME}`)
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`)
    sh('bun', [`${ROOT}apps/server/src/db/migrate.ts`], { DATABASE_URL: DB_URL })

    // 2. Server (fake AI, auth off).
    console.log('[server] start')
    server = spawn('bun', ['run', 'start'], {
      cwd: `${ROOT}apps/server`,
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(API_PORT),
        DATABASE_URL: DB_URL,
        ENGRAM_FAKE_AI: '1',
        ENGRAM_AUTH_DISABLED: '1',
        ANTHROPIC_API_KEY: 'capture-fake-key',
        TZ: 'Europe/Paris',
      },
    })
    await waitFor(`${API}/api/health`, 'API health')

    // 3. Web dev server (proxies /api → server). No build needed for screenshots.
    console.log('[web] start')
    web = spawn('bunx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
      cwd: `${ROOT}apps/web`,
      stdio: 'inherit',
      env: { ...process.env, VITE_API_TARGET: API },
    })
    await waitFor(WEB, 'web dev server')

    // 4. Seed the deterministic dataset via the backup import.
    console.log('[seed] import backup')
    const res = await fetch(`${API}/api/backup/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSeedBackup(new Date())),
    })
    if (!res.ok) throw new Error(`seed import failed: ${res.status} ${await res.text()}`)
    console.log('[seed]', await res.text())

    // 5. Capture.
    mkdirSync(LANDING_DIR, { recursive: true })
    mkdirSync(VERIFY_DIR, { recursive: true })
    const browser = await chromium.launch()
    try {
      if (!verifyOnly) {
        // -- Product captures: theme × language (four variants per screen). --
        for (const theme of ['dark', 'light'] as const) {
          for (const lang of ['fr', 'en'] as const) {
            const ctx = await browser.newContext({ deviceScaleFactor: 2 })
            const page = await ctx.newPage()
            await primeContext(page, theme, lang)
            const suffix = `${theme}-${lang}`

            await page.setViewportSize({ width: 1440, height: 780 })
            await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
            await page.waitForTimeout(1200)
            await shot(page, `dashboard-${suffix}`)

            await page.setViewportSize({ width: 1080, height: 840 })
            await page.goto(`${WEB}/review`, { waitUntil: 'networkidle' })
            await page.waitForTimeout(800)
            // Reveal the answer so the capture shows the flipped card WITH the
            // question recall + the four ratings (the state that actually exists).
            await page.keyboard.press('Space')
            await page.waitForTimeout(700)
            await shot(page, `review-${suffix}`)

            await page.setViewportSize({ width: 1440, height: 980 })
            await page.goto(`${WEB}/analytics`, { waitUntil: 'networkidle' })
            await page.waitForTimeout(1400)
            await shot(page, `analytics-${suffix}`)

            await ctx.close()
          }
        }

        // -- Social card (og.png): the landing hero at the declared 1200×630,
        //    deviceScaleFactor 1 so the file matches og:image:width/height. --
        const ogCtx = await browser.newContext({ deviceScaleFactor: 1 })
        const ogPage = await ogCtx.newPage()
        await primeContext(ogPage, 'dark', 'fr')
        await ogPage.setViewportSize({ width: 1200, height: 630 })
        await ogPage.goto(`${WEB}/welcome`, { waitUntil: 'networkidle' })
        await ogPage.waitForTimeout(800)
        await ogPage.screenshot({
          path: `${LANDING_DIR}/og.png`,
          clip: { x: 0, y: 0, width: 1200, height: 630 },
        })
        await ogCtx.close()
      }

      // -- Verification shots (FR), each fix at its cited viewport. --
      for (const theme of ['dark', 'light'] as const) {
        const ctx = await browser.newContext({ deviceScaleFactor: 2 })
        const page = await ctx.newPage()
        await primeContext(page, theme, 'fr')

        // Landing desktop (header CTA + toggle, final CTA at page foot).
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.goto(`${WEB}/welcome`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(600)
        await page.screenshot({
          path: `${VERIFY_DIR}/landing-desktop-${theme}.png`,
          fullPage: true,
        })
        // Landing mobile (rhythm-strip fade, stacked CTAs).
        await page.setViewportSize({ width: 360, height: 740 })
        await page.goto(`${WEB}/welcome`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${VERIFY_DIR}/landing-mobile-${theme}.png`, fullPage: true })

        if (theme === 'dark') {
          // Planning legend (desktop month view).
          await page.setViewportSize({ width: 1280, height: 900 })
          await page.goto(`${WEB}/planning`, { waitUntil: 'networkidle' })
          await page.waitForTimeout(800)
          await page.screenshot({ path: `${VERIFY_DIR}/planning-legend.png` })
          // Import note detail (generation history rows).
          await page.goto(`${WEB}/import/note-automates`, { waitUntil: 'networkidle' })
          await page.waitForTimeout(800)
          await page.screenshot({ path: `${VERIFY_DIR}/generation-history.png`, fullPage: true })
          // Photo import sticky CTA (mobile).
          await page.setViewportSize({ width: 390, height: 740 })
          await page.goto(`${WEB}/analytics`, { waitUntil: 'networkidle' }) // dashboard activity band shows on '/'
          await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
          await page.waitForTimeout(600)
          await page.screenshot({ path: `${VERIFY_DIR}/dashboard-mobile.png`, fullPage: true })
        }

        await ctx.close()
      }
    } finally {
      await browser.close()
    }
    console.log('[done] captures + verification shots written')
  } finally {
    server?.kill('SIGKILL')
    web?.kill('SIGKILL')
    try {
      await admin.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid<>pg_backend_pid()`,
      )
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME}`)
      console.log(`[db] dropped ${DB_NAME}`)
    } finally {
      await admin.end()
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
