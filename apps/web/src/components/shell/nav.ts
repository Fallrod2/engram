import {
  CalendarDays,
  ChartColumn,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TKey } from '@/lib/i18n'

export interface NavItem {
  /** i18n key resolved with `t(...)` at render (spec §9.4). */
  label: TKey
  to: string
  icon: LucideIcon
}

export interface NavGroup {
  id: string
  /** i18n key resolved with `t(...)` at render. */
  label: TKey
  items: NavItem[]
}

/**
 * Primary navigation (spec §5). The "Session de révision" item carries the real
 * total due count; the Matières group is filled with real subjects at runtime
 * (see `sidebar.tsx`). Labels are i18n keys resolved by the consumer.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'review',
    label: 'nav.groups.review',
    items: [
      { label: 'nav.items.today', to: '/', icon: LayoutDashboard },
      { label: 'nav.items.session', to: '/review', icon: GraduationCap },
    ],
  },
  {
    id: 'subjects',
    label: 'nav.groups.subjects',
    items: [{ label: 'nav.items.allSubjects', to: '/subjects', icon: Layers }],
  },
  {
    id: 'tools',
    label: 'nav.groups.tools',
    items: [
      { label: 'nav.items.planning', to: '/planning', icon: CalendarDays },
      { label: 'nav.items.analytics', to: '/analytics', icon: ChartColumn },
      { label: 'nav.items.import', to: '/import', icon: Upload },
    ],
  },
]

/** Flat, ordered list of every static nav item — drives roving tabindex + ⌘1…9. */
export const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
