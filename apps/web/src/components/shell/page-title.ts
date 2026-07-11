/** Map a pathname to its page title (spec §5 header). */
const TITLES: Record<string, string> = {
  '/': "Aujourd'hui",
  '/review': 'Session de révision',
  '/subjects': 'Matières',
  '/planning': 'Planning',
  '/analytics': 'Analytics',
  '/settings': 'Réglages',
}

export function getPageTitle(pathname: string): string {
  return TITLES[pathname] ?? 'engram'
}
