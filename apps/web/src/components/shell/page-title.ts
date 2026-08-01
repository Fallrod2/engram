import type { TKey } from '@/lib/i18n'

/**
 * Map a pathname to its page-title i18n key (spec §5 header, §9.4).
 *
 * ONLY ROUTES THAT RENDER INSIDE THE SHELL BELONG HERE. This map feeds exactly
 * one thing — the `<Header>` title in `app-shell.tsx`. The bare routes
 * (`/login`, `/signup`, `/forgot-password`, `/set-password`, `/welcome`,
 * `/suspended`, `/onboarding`) are returned by `RootLayout` as a naked
 * `<Outlet/>` and never reach this function at all, so an entry for one of them
 * would be dead code that reads like coverage. They name themselves through
 * `useDocumentTitle`, which is the surface they actually have (the browser tab).
 */
const TITLES: Record<string, TKey> = {
  '/': 'pageTitle.today',
  '/review': 'pageTitle.session',
  '/subjects': 'pageTitle.subjects',
  '/planning': 'pageTitle.planning',
  '/analytics': 'pageTitle.analytics',
  '/import': 'pageTitle.import',
  '/search': 'pageTitle.search',
  // `/admin` is in the shell like any other section, and was the one that fell
  // through to `pageTitle.fallback`: its header read "engram" while the page
  // below it said "Administration" (T-041).
  '/admin': 'pageTitle.admin',
  '/settings': 'pageTitle.settings',
}

/**
 * Whether the SHELL header carries the route's single `<h1>` (Phase 7 §3.1).
 * True on section roots (their in-content `PageHeader` has no title, so the
 * shell owns the heading). False on detail routes (`/subjects/:id…`,
 * `/import/:noteId…`), where the in-content `PageHeader` renders the descriptive
 * `<h1>` — the shell then renders a styled `<p>` so every route has exactly one
 * `<h1>`.
 */
export function shellOwnsHeading(pathname: string): boolean {
  if (/^\/subjects\/[^/]+/.test(pathname)) return false
  if (/^\/import\/[^/]+/.test(pathname)) return false
  // `/admin` is a section root that nevertheless renders its OWN `<h1>`
  // ("Administration", with its shield glyph) through `PageHeader`. Naming it in
  // `TITLES` without this line would have traded one bug for a worse one: the
  // header stopped saying "engram" and started saying "Administration" a second
  // time, in a second `<h1>`. A screen reader would announce the page's heading
  // twice and the route would break the one-`<h1>` rule below.
  if (pathname === '/admin') return false
  return true
}

/** The page title i18n key for a pathname; resolve with `t(...)` at render. */
export function getPageTitleKey(pathname: string): TKey {
  // The subjects subtree (decks, cards) keeps the section title in the global
  // header; each screen renders its own breadcrumb + entity title in-content.
  if (pathname.startsWith('/subjects')) return 'pageTitle.subjects'
  // The import subtree (note detail, generation review) likewise keeps the
  // section title in the global header and renders its own in-content breadcrumb.
  if (pathname.startsWith('/import')) return 'pageTitle.import'
  return TITLES[pathname] ?? 'pageTitle.fallback'
}
