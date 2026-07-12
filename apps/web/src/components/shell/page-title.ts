import type { TKey } from '@/lib/i18n'

/** Map a pathname to its page-title i18n key (spec §5 header, §9.4). */
const TITLES: Record<string, TKey> = {
  '/': 'pageTitle.today',
  '/review': 'pageTitle.session',
  '/subjects': 'pageTitle.subjects',
  '/planning': 'pageTitle.planning',
  '/analytics': 'pageTitle.analytics',
  '/import': 'pageTitle.import',
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
