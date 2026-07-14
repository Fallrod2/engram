import { Link } from '@tanstack/react-router'
import { Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/use-media-query'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from './theme-toggle'
import { useShell } from './shell-context'

/**
 * App header (spec §5). 48px, sticky, transparent → bg + blur + hairline on
 * scroll. Title left; contextual actions right (mobile gets search + theme,
 * since the sidebar footer is hidden below `md`).
 */
export function Header({
  title,
  scrolled,
  asHeading,
}: {
  title: string
  scrolled: boolean
  /**
   * Render the title as the page `<h1>`. On detail routes the in-content
   * `PageHeader` owns the `<h1>`, so the shell renders a non-heading `<p>` (same
   * styling) to keep exactly one `<h1>` per route (Phase 7 §3.1).
   */
  asHeading: boolean
}) {
  const { setCommandOpen } = useShell()
  const t = useT()
  // Mobile has no sidebar, so the header title doubles as the way back to the
  // dashboard `/` (spec §5.5); on desktop the sidebar owns navigation.
  const isMobile = !useMediaQuery('(min-width: 768px)')
  const TitleTag = asHeading ? 'h1' : 'p'

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-12 items-center gap-3 px-4 md:px-8',
        'transition-colors duration-base',
        scrolled
          ? 'border-b border-border bg-bg/80 backdrop-blur'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <TitleTag className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-text">
        {isMobile ? (
          <Link
            to="/"
            className="transition-colors duration-fast hover:text-text-muted"
            aria-label={t('header.backToDashboardAria', { title })}
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </TitleTag>

      <div className="ml-auto flex items-center gap-1 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('header.search')}
          onClick={() => setCommandOpen(true)}
          className="text-text-muted"
        >
          <Search />
        </Button>
        {/* Settings gear — the mobile path to /settings (AI config), since the
            sidebar footer is hidden below md (fix-mobile-shell §nav). */}
        <Button variant="ghost" size="icon" asChild className="text-text-muted">
          <Link to="/settings" aria-label={t('header.settings')}>
            <Settings />
          </Link>
        </Button>
        <ThemeToggle />
      </div>
      {/* Desktop search lives solely in the sidebar (its ghost ⌘K row) — a single
          search affordance on ≥md, not the former sidebar+topbar pair (finding:
          double ⌘K control at ≥lg). ⌘K still opens the palette from anywhere. */}
    </header>
  )
}
