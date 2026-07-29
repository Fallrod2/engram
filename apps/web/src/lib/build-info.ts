/**
 * Build identity — what "Réglages → À propos" prints, and the host the landing's
 * browser bezels are labelled with.
 *
 * WHY NOT `package.json`. Every workspace is pinned at `0.0.0` and nothing bumps
 * it: the About card printed "Version 0.0.0" on a live public deployment, which
 * a tester read (rightly) as "this build is not real". Any hand-maintained
 * version string has that failure mode built in — it is correct only for as long
 * as someone remembers to edit it. So the version is DERIVED, never authored:
 *
 *   commit  ← `VERCEL_GIT_COMMIT_SHA` on Vercel, `git rev-parse` locally,
 *             both resolved in `apps/web/vite.config.ts` and injected as
 *             `VITE_APP_COMMIT` (see the `define` block there).
 *   date    ← the build's own clock (`VITE_APP_BUILT_AT`).
 *
 * Neither can go stale without the build itself changing, which is the property
 * we actually want. A checkout with no git and no Vercel env (a source tarball)
 * degrades to the build date alone rather than lying about a revision.
 */

/**
 * Read a `VITE_*` define. These are string-substituted at build time; under
 * Vitest (which does not load `apps/web/vite.config.ts`) they are simply absent,
 * hence the guard — the fallbacks below are the tested path.
 */
function define(key: 'VITE_APP_COMMIT' | 'VITE_APP_BUILT_AT' | 'VITE_SITE_HOST'): string {
  const value: unknown = import.meta.env?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** Short commit sha of the running build; `''` when it could not be resolved. */
export const BUILD_COMMIT = define('VITE_APP_COMMIT')

/** ISO instant the bundle was built; `''` outside a real build (unit tests). */
export const BUILD_BUILT_AT = define('VITE_APP_BUILT_AT')

/**
 * Pure formatter behind `appVersionLabel`, exported so the four degradation
 * paths can be pinned without a build (the injected defines do not exist under
 * Vitest, so the live function only ever exercises the last one).
 *
 * The date is rendered as a bare ISO day on purpose — it sits in the mono column
 * next to a sha, it must not shift width with the UI language, and `YYYY-MM-DD`
 * is the one form no reader mis-parses. Falls back to the commit alone, then to
 * the date alone, then to `dev` (a build that knows neither is, by elimination,
 * somebody's local one).
 */
export function formatVersionLabel(commit: string, builtAt: string): string {
  const day = builtAt.slice(0, 10)
  if (commit && day) return `${commit} · ${day}`
  return commit || day || 'dev'
}

/** What the About card shows next to "Version": `4f3a9c1 · 2026-07-29`. */
export function appVersionLabel(): string {
  return formatVersionLabel(BUILD_COMMIT, BUILD_BUILT_AT)
}

/**
 * Host to print inside the landing's fake browser chrome.
 *
 * Default: the host the page is ACTUALLY served from — `engram.alexabriel.com`
 * in production, `localhost:5173` for a developer, the preview host on a Vercel
 * preview. True everywhere, configured nowhere, which is the whole point: the
 * frames used to be hard-labelled "localhost" on the public site.
 *
 * `VITE_SITE_HOST` overrides it for the ONE case where the runtime host is not
 * the host being advertised: `scripts/generate-landing-shots.ts` renders the
 * landing from a throwaway dev server on :5176 to produce `og.png`, the image
 * social platforms show for the production site.
 */
export function siteHost(): string {
  const configured = define('VITE_SITE_HOST')
  if (configured) return configured
  if (typeof window !== 'undefined' && window.location?.host) return window.location.host
  return ''
}
