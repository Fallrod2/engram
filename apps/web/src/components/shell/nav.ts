import { CalendarDays, ChartColumn, GraduationCap, Layers, LayoutDashboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

/**
 * Primary navigation (spec §5). The "Session de révision" item carries the real
 * total due count; the Matières group is filled with real subjects at runtime
 * (see `sidebar.tsx`).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'review',
    label: 'Réviser',
    items: [
      { label: "Aujourd'hui", to: '/', icon: LayoutDashboard },
      { label: 'Session de révision', to: '/review', icon: GraduationCap },
    ],
  },
  {
    id: 'subjects',
    label: 'Matières',
    items: [{ label: 'Toutes les matières', to: '/subjects', icon: Layers }],
  },
  {
    id: 'tools',
    label: 'Outils',
    items: [
      { label: 'Planning', to: '/planning', icon: CalendarDays },
      { label: 'Analytics', to: '/analytics', icon: ChartColumn },
    ],
  },
]

/** Flat, ordered list of every static nav item — drives roving tabindex + ⌘1…9. */
export const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
