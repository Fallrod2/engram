import { Link } from '@tanstack/react-router'
import { CalendarDays, ChartColumn, GraduationCap, Layers } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TabEntry {
  label: string
  to: string
  icon: LucideIcon
}

/** Bottom tab bar for `<768px` (spec §5). Four entries, thumb-reachable. */
const TABS: TabEntry[] = [
  { label: 'Réviser', to: '/review', icon: GraduationCap },
  { label: 'Matières', to: '/subjects', icon: Layers },
  { label: 'Planning', to: '/planning', icon: CalendarDays },
  { label: 'Stats', to: '/analytics', icon: ChartColumn },
]

export function MobileTabBar() {
  return (
    <nav
      aria-label="Navigation mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-surface-1/90 backdrop-blur md:hidden"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 text-text-faint',
            'transition-colors duration-fast data-[status=active]:text-accent',
          )}
        >
          <tab.icon className="size-5" />
          <span className="text-2xs font-medium">{tab.label}</span>
        </Link>
      ))}
    </nav>
  )
}
