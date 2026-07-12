import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/use-media-query'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ThemeToggle } from './theme-toggle'
import { useShell } from './shell-context'

/**
 * App header (spec §5). 48px, sticky, transparent → bg + blur + hairline on
 * scroll. Title left; contextual actions right (mobile gets search + theme,
 * since the sidebar footer is hidden below `md`).
 */
export function Header({ title, scrolled }: { title: string; scrolled: boolean }) {
  const { setCommandOpen } = useShell()
  const t = useT()
  // Mobile has no sidebar, so the header title doubles as the way back to the
  // dashboard `/` (spec §5.5); on desktop the sidebar owns navigation.
  const isMobile = !useMediaQuery('(min-width: 768px)')

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
      <h1 className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-text">
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
      </h1>

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
        <ThemeToggle />
      </div>

      <div className="ml-auto hidden items-center gap-2 md:flex">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="hidden h-8 items-center gap-2 rounded-sm border border-border bg-surface-1 px-2.5 text-text-faint transition-colors duration-fast hover:bg-surface-2 lg:flex"
          aria-label={t('header.search')}
        >
          <Search className="size-3.5" />
          <span className="text-xs">{t('header.search')}</span>
          <Kbd className="ml-1">⌘K</Kbd>
        </button>
      </div>
    </header>
  )
}
