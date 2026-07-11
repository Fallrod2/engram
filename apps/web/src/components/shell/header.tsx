import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
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
      <h1 className="truncate text-xl font-semibold tracking-[-0.02em] text-text">{title}</h1>

      <div className="ml-auto flex items-center gap-1 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Rechercher"
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
          aria-label="Rechercher"
        >
          <Search className="size-3.5" />
          <span className="text-xs">Rechercher</span>
          <Kbd className="ml-1">⌘K</Kbd>
        </button>
      </div>
    </header>
  )
}
