import { CalendarDays, ChartColumn, GraduationCap, Layers, LayoutDashboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** A subject pigment slot (1-8) mapped to `--color-subject-N` (spec §1). */
export type SubjectColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Due count. `0` renders as the retreating `·` (spec §6). Fake for Phase 0. */
  count?: number
  /** When set, the row shows a subject dot instead of a plain icon. */
  subject?: SubjectColor
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

/**
 * Primary navigation (spec §5). Counts are fake `0` for Phase 0 — the queue is
 * empty, so every due count reads as the calm `·`.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'review',
    label: 'Réviser',
    items: [
      { label: "Aujourd'hui", to: '/', icon: LayoutDashboard },
      { label: 'Session de révision', to: '/review', icon: GraduationCap, count: 0 },
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

/** Flat, ordered list of every focusable nav item — drives roving tabindex + ⌘1…9. */
export const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/**
 * Subject preview rows (spec §5/§6). Static in Phase 0 — no per-subject route
 * exists yet — purely to show the dot + mono due-count language. All at `0`.
 */
export interface SubjectPreview {
  label: string
  subject: SubjectColor
  count: number
}

export const SUBJECT_PREVIEW: SubjectPreview[] = [
  { label: 'Théorie des langages', subject: 1, count: 0 },
  { label: 'Anglais', subject: 2, count: 0 },
  { label: 'Algorithmique', subject: 3, count: 0 },
]
