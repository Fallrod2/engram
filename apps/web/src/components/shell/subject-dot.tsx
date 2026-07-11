import { cn } from '@/lib/utils'
import type { SubjectColor } from './nav'

const DOT_BG: Record<SubjectColor, string> = {
  1: 'bg-subject-1',
  2: 'bg-subject-2',
  3: 'bg-subject-3',
  4: 'bg-subject-4',
  5: 'bg-subject-5',
  6: 'bg-subject-6',
  7: 'bg-subject-7',
  8: 'bg-subject-8',
}

/** 8px subject pigment dot (spec §1/§5). */
export function SubjectDot({ subject, className }: { subject: SubjectColor; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT_BG[subject], className)}
      aria-hidden
    />
  )
}
