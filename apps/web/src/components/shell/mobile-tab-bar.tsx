import { Link } from '@tanstack/react-router'
import { CalendarDays, ChartColumn, GraduationCap, ImageUp, Layers } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT, type TKey } from '@/lib/i18n'

interface TabEntry {
  /** i18n key resolved with `t(...)` at render. */
  label: TKey
  to: string
  icon: LucideIcon
}

/**
 * Bottom tab bar for `<768px` (spec §5). Import joins the four core sections so
 * the mobile-flagship photo flow is one tap away; Settings is reached from the
 * header gear (fix-mobile-shell §nav).
 */
const TABS: TabEntry[] = [
  { label: 'tabbar.review', to: '/review', icon: GraduationCap },
  { label: 'tabbar.subjects', to: '/subjects', icon: Layers },
  { label: 'tabbar.planning', to: '/planning', icon: CalendarDays },
  { label: 'tabbar.stats', to: '/analytics', icon: ChartColumn },
  { label: 'tabbar.import', to: '/import', icon: ImageUp },
]

export function MobileTabBar() {
  const t = useT()
  return (
    <nav
      aria-label={t('nav.aria.mobileNav')}
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
          <span className="text-2xs font-medium">{t(tab.label)}</span>
        </Link>
      ))}
    </nav>
  )
}
