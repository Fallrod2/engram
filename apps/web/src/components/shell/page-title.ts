/** Map a pathname to its page title (spec §5 header). */
const TITLES: Record<string, string> = {
  '/': "Aujourd'hui",
  '/review': 'Session de révision',
  '/subjects': 'Matières',
  '/planning': 'Planning',
  '/analytics': 'Analytics',
  '/import': 'Import',
  '/settings': 'Réglages',
}

export function getPageTitle(pathname: string): string {
  // The subjects subtree (decks, cards) keeps the section title in the global
  // header; each screen renders its own breadcrumb + entity title in-content.
  if (pathname.startsWith('/subjects')) return 'Matières'
  // The import subtree (note detail, generation review) likewise keeps the
  // section title in the global header and renders its own in-content breadcrumb.
  if (pathname.startsWith('/import')) return 'Import'
  return TITLES[pathname] ?? 'engram'
}
