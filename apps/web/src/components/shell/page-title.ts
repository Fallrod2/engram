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
