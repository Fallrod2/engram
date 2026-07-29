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
 * Isolation: a throwaway `engram_fixlandingpolish_*` database on a LOCAL Postgres
 * (the Supabase CLI stack on 127.0.0.1:54322 by default; override with
 * `LANDING_DATABASE_URL` for a local instance on another port) — created +
 * migrated + dropped here, never touching the shared `postgres` db. Dev ports
 * 3004 (API) / 5176 (web), never the 3001/5173 dev or 3100/3110 e2e ranges.
 * Everything is torn down in `finally`.
 *
 *   bun scripts/generate-landing-shots.ts            # product captures + og + verify shots
 *   bun scripts/generate-landing-shots.ts --verify   # only the before/after verify shots
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { chromium, type Page } from '@playwright/test'
import { assertLocalDatabaseUrl } from '../apps/server/src/db/local-guard'
import { DEFAULT_DATABASE_URL } from '../apps/server/src/db/paths'
import { buildSeedBackup } from './landing-seed'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const API_PORT = 3004
const WEB_PORT = 5176
/**
 * A SECOND web server, for the landing only. Two servers because the landing and
 * the product screens need opposite auth builds, and `AUTH_ENABLED_WEB` is
 * decided at BUILD time (`apps/web/src/lib/supabase.ts`):
 *
 *  - product captures need it OFF. With auth on, the app shell has no session
 *    and bounces every route to `/login`.
 *  - the landing needs it ON. With auth off, `auth-store.ts` starts the session
 *    at `authenticated` (the deliberate local-dev default), so `/welcome`
 *    renders its SIGNED-IN variant — the og card came out advertising "Ouvrir
 *    l'app" to strangers instead of "Créer un compte".
 *
 * The Supabase values are deliberately unreachable: `getSession()` reads
 * localStorage, finds nothing, and settles on `unauthenticated` without a single
 * request. Nothing here talks to a real project.
 */
const LANDING_WEB_PORT = 5196
const FAKE_SUPABASE_URL = 'https://landing-capture.invalid'
const FAKE_SUPABASE_ANON = 'landing-capture-anon-key'
const API = `http://localhost:${API_PORT}`
const WEB = `http://localhost:${WEB_PORT}`
const LANDING_WEB = `http://localhost:${LANDING_WEB_PORT}`
/**
 * Base connection string for the throwaway database. Any LOCAL Postgres works —
 * the guard is on the host, never on the port (a stack on 5433 is as safe as the
 * usual 54322) — and a non-local value is refused outright, so this script can
 * never CREATE/DROP databases on the Supabase cloud project. `DATABASE_URL` is
 * deliberately NOT read: in normal dev it points at the cloud.
 */
const BASE_URL = process.env.LANDING_DATABASE_URL || DEFAULT_DATABASE_URL
assertLocalDatabaseUrl(BASE_URL, 'generate-landing-shots', 'LANDING_DATABASE_URL')

/** Same instance, different database name. */
const onBase = (database: string) => {
  const url = new URL(BASE_URL)
  url.pathname = `/${database}`
  return url.toString()
}

const ADMIN_URL = onBase('postgres')
const DB_NAME = `engram_fixlandingpolish_${Date.now()}`
const DB_URL = onBase(DB_NAME)

const LANDING_DIR = `${ROOT}apps/web/public/landing`
/**
 * Where the `--verify` shots land. It used to be one agent session's scratchpad,
 * hard-coded — a path that no longer exists on any machine, this one included.
 * Overridable, and otherwise a plain temp directory.
 */
const VERIFY_DIR = process.env.LANDING_VERIFY_DIR ?? `${tmpdir()}/engram-landing-verify`

/**
 * Host printed in the landing's fake browser chrome for `og.png`.
 *
 * The page normally reads `window.location.host`, which is the truth in prod and
 * in dev alike (`apps/web/src/lib/build-info.ts#siteHost`). `og.png` is the one
 * exception: it is rendered from this throwaway dev server but represents the
 * PRODUCTION site on every social platform that unfurls the link, so labelling
 * the frames `localhost:5176` would put a lie in the shared card — which is the
 * exact bug ("engram · localhost" on a public site) this run exists to fix.
 */
const SITE_HOST = process.env.LANDING_SITE_HOST ?? 'engram.alexabriel.com'

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

/** SIGKILL a detached child AND everything it spawned (see `detached` below). */
function killTree(child: ChildProcess | undefined) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function toWebp(png: string, webp: string) {
  execFileSync('cwebp', ['-quiet', '-q', '90', png, '-o', webp])
  rmSync(png, { force: true })
}

/**
 * Wait until the screen has actually RESOLVED, not merely finished its network.
 *
 * The previous version slept a fixed 1.2 s after `networkidle` and shipped the
 * result. That held only as long as the seed stayed tiny: with a realistic
 * dataset the first run photographed a dashboard made entirely of skeletons —
 * subject rows as grey bars, a streak of 0, every panel a placeholder. Nothing
 * in the script could tell, because a skeleton IS a successfully rendered page.
 *
 * The app's loading convention is `<Skeleton>` (never a spinner), which is the
 * only element carrying `animate-pulse` on these three screens once the API
 * status dot has resolved — so "no pulse anywhere" is a sound, screen-agnostic
 * definition of settled. `expect` is the caller's job on top of this.
 */
async function settle(page: Page, label: string) {
  await page.waitForLoadState('networkidle')
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, undefined, {
      timeout: 30_000,
    })
    .catch(() => {
      throw new Error(`${label}: still showing skeletons after 30 s — refusing to capture it`)
    })
}

/** Screenshot the current page to `<LANDING_DIR>/<name>.webp` (via a temp PNG). */
async function shot(page: Page, name: string) {
  const png = `${LANDING_DIR}/${name}.png`
  await page.screenshot({ path: png })
  toWebp(png, `${LANDING_DIR}/${name}.webp`)
}

/**
 * Set theme + language before any app script runs, skip onboarding, and pin the
 * session draw.
 *
 * THE DRAW. `features/review/queue-order.ts` does NOT present the queue in the
 * server's order: it re-samples it, weighted by FSRS difficulty, through
 * `Math.random` — deliberately, so the answer is never recalled from a card's
 * position. Excellent for a user, useless for a reproducible capture: the first
 * card was a different one on every run, and on the run that exposed this it was
 * a NEVER-SEEN card, whose rating zone is two buttons ("J'ai eu faux / juste")
 * rather than the four the landing's alt text promises.
 *
 * Pinning `Math.random` to 0 makes `orderQueue` the identity — the sweep always
 * settles on the first pool entry — so the session shows the queue in the
 * server's own `due ASC, created_at ASC` order, which is the order the seed
 * controls (`landing-seed.ts`, the `first` card). Capture-only, in the page
 * context, and nothing in the app reads `Math.random` for anything but this draw.
 */
async function primeContext(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(
    ([th, lg]) => {
      localStorage.setItem('engram-theme', th)
      localStorage.setItem('engram-lang', lg)
      localStorage.setItem('engram-onboarding-dismissed', '1')
      Math.random = () => 0
    },
    [theme, lang] as const,
  )
}

/**
 * A user id nobody has, handed to `ENGRAM_ADMIN_USER_ID` for the capture pass.
 *
 * Under the dev bypass, `resolveAdminUserId` falls back to the DEFAULT identity
 * (`apps/server/src/auth/config.ts`), so the capture user is an administrator
 * and the sidebar grows an "Administration" row — an internal IAM console, in
 * every dashboard and analytics shot on a page selling a personal review app.
 * Naming somebody else as the admin demotes the capture user to what a visitor
 * would actually be. It cannot be set for the SEED pass: `POST /api/backup/import`
 * is admin-only, which is exactly why the server is restarted between the two.
 */
const NOBODY_IS_ADMIN = '00000000-0000-4000-8000-000000000000'

async function main() {
  let server: ChildProcess | undefined
  let web: ChildProcess | undefined
  let landingWeb: ChildProcess | undefined
  const admin = postgres(ADMIN_URL, { max: 1 })

  /** The API server, optionally with the admin role pointed at nobody. */
  const startServer = (adminUserId?: string) =>
    spawn('bun', ['run', 'start'], {
      cwd: `${ROOT}apps/server`,
      stdio: 'inherit',
      // Own process group, so teardown can kill the GRANDCHILD too. `bun run
      // start` is a launcher: killing it left the real server holding :3004,
      // and the next run then died on a port already in use.
      detached: true,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        DATABASE_URL: DB_URL,
        ENGRAM_FAKE_AI: '1',
        ENGRAM_AUTH_DISABLED: '1',
        ANTHROPIC_API_KEY: 'capture-fake-key',
        TZ: 'Europe/Paris',
        ...(adminUserId ? { ENGRAM_ADMIN_USER_ID: adminUserId } : {}),
      },
    })

  try {
    // 1. Throwaway DB + migrate (reuse the real migrator for zero schema drift).
    console.log(`[db] create ${DB_NAME}`)
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`)
    sh('bun', [`${ROOT}apps/server/src/db/migrate.ts`], { DATABASE_URL: DB_URL })

    // 2. Server (fake AI, auth off).
    console.log('[server] start')
    server = startServer()
    await waitFor(`${API}/api/health`, 'API health')

    // 3. Web dev server (proxies /api → server). No build needed for screenshots.
    console.log('[web] start')
    web = spawn('bunx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
      cwd: `${ROOT}apps/web`,
      stdio: 'inherit',
      detached: true, // same reason as the server above
      env: { ...process.env, VITE_API_TARGET: API, VITE_SITE_HOST: SITE_HOST },
    })
    await waitFor(WEB, 'web dev server')

    // 3b. The landing's own web server — same code, auth-enabled build, so the
    //     page renders for an ANONYMOUS visitor. See `LANDING_WEB_PORT`.
    console.log('[web] start (landing, anonymous)')
    landingWeb = spawn('bunx', ['vite', '--port', String(LANDING_WEB_PORT), '--strictPort'], {
      cwd: `${ROOT}apps/web`,
      stdio: 'inherit',
      detached: true,
      env: {
        ...process.env,
        VITE_API_TARGET: API,
        VITE_SITE_HOST: SITE_HOST,
        VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: FAKE_SUPABASE_ANON,
      },
    })
    await waitFor(LANDING_WEB, 'landing web dev server')

    // 4. Seed the deterministic dataset via the backup import.
    console.log('[seed] import backup')
    const res = await fetch(`${API}/api/backup/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSeedBackup(new Date())),
    })
    if (!res.ok) throw new Error(`seed import failed: ${res.status} ${await res.text()}`)
    console.log('[seed]', await res.text())

    // 4b. Warm the read paths. The seed is ~2 500 review logs, and the first
    // analytics/heatmap/study-plan query against a freshly written database is
    // by far the slowest one — paying for it here rather than inside the first
    // page load is what keeps the dashboard from being photographed mid-skeleton.
    const now = new Date().toISOString()
    await Promise.all(
      [
        '/api/review/counts',
        `/api/review/queue?now=${encodeURIComponent(now)}`,
        '/api/analytics/heatmap',
        '/api/analytics/streak',
        '/api/analytics/retention',
        '/api/analytics/study-time',
        '/api/analytics/volume',
        '/api/study-plan/today',
        '/api/subjects',
      ].map((p) => fetch(`${API}${p}`).catch(() => undefined)),
    )
    console.log('[seed] read paths warmed')

    // 4c. Restart the API with the admin role pointed at nobody, so the captures
    //     show the sidebar a VISITOR would have — no "Administration" row. The
    //     seed above needed the admin identity, hence the restart rather than a
    //     single set of env vars. See `NOBODY_IS_ADMIN`.
    console.log('[server] restart as non-admin')
    killTree(server)
    server = startServer(NOBODY_IS_ADMIN)
    await waitFor(`${API}/api/health`, 'API health (non-admin)')

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
            await settle(page, `dashboard-${suffix}`)
            // The heroic due counter is the whole point of the dashboard shot;
            // a `0` there means the seed or the query failed, and a capture is
            // worse than no capture.
            await page.waitForSelector('text=/\\d+/', { state: 'attached' })
            await page.waitForTimeout(400)
            await shot(page, `dashboard-${suffix}`)

            // 780 rather than 840: the refactored session hangs a FIXED-height
            // block off the rating zone (T-023), so a taller viewport only adds
            // empty page around it — which is precisely how the previous review
            // capture ended up two thirds black.
            await page.setViewportSize({ width: 1080, height: 780 })
            await page.goto(`${WEB}/review`, { waitUntil: 'networkidle' })
            await settle(page, `review-${suffix}`)
            // Reveal the answer so the capture shows the revealed card WITH the
            // question recall + the four ratings — the state the landing's own
            // alt text promises ("les quatre notes Encore, Difficile, Bien,
            // Facile"), which is why the review shot is NOT a QCM: a QCM the
            // visitor answered collapses those four buttons into one "Suivant".
            await page.keyboard.press('Space')
            // The first card's answer carries math, and KaTeX lives in its own
            // lazily-imported chunk (`vendor-katex`). Without this wait the shot
            // can catch the raw `$…$` source — a failure mode that is invisible
            // to the script and glaring on the landing.
            await page.waitForSelector('.katex', { timeout: 15_000 })
            // And the four rating buttons must actually be on screen: the whole
            // claim of this capture is that they are.
            await page.waitForSelector('[data-slot="answer"]', { timeout: 5_000 })
            await page.waitForTimeout(700)
            await shot(page, `review-${suffix}`)

            await page.setViewportSize({ width: 1440, height: 980 })
            await page.goto(`${WEB}/analytics`, { waitUntil: 'networkidle' })
            await settle(page, `analytics-${suffix}`)
            // Recharts animates its series in; capturing mid-animation gives
            // half-drawn bars. `.recharts-surface` exists from the first frame,
            // so the extra pause is what actually matters here.
            await page.waitForSelector('.recharts-surface', { timeout: 15_000 })
            await page.waitForTimeout(1600)
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
        await ogPage.goto(`${LANDING_WEB}/welcome`, { waitUntil: 'networkidle' })
        await settle(ogPage, 'og')
        // The hero rises in with a 240 ms stagger up to `delay: 0.28` — long
        // enough that a fixed 800 ms once caught the title mid-translate.
        await ogPage.waitForTimeout(1200)
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
        await page.goto(`${LANDING_WEB}/welcome`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(600)
        await page.screenshot({
          path: `${VERIFY_DIR}/landing-desktop-${theme}.png`,
          fullPage: true,
        })
        // Landing mobile (rhythm-strip fade, stacked CTAs).
        await page.setViewportSize({ width: 360, height: 740 })
        await page.goto(`${LANDING_WEB}/welcome`, { waitUntil: 'networkidle' })
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
    killTree(server)
    killTree(web)
    killTree(landingWeb)
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
