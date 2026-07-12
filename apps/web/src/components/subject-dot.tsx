import { cn } from '@/lib/utils'
import { SUBJECT_BG_CLASS, pigmentSlotForHex } from '@/lib/pigments'

/**
 * 8px subject pigment dot (spec §1.10). Resolves the stored hex to its themeable
 * `--color-subject-N` token (via a literal Tailwind class so it isn't tree-shaken);
 * a non-canonical hex falls back to the raw value.
 */
export function SubjectDot({
  color,
  className,
  muted,
}: {
  color: string
  className?: string
  /** Archived subjects render desaturated (spec §2). */
  muted?: boolean
}) {
  const slot = pigmentSlotForHex(color)
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        slot ? SUBJECT_BG_CLASS[slot] : undefined,
        muted && 'opacity-40',
        className,
      )}
      style={slot ? undefined : { background: color }}
      aria-hidden
    />
  )
}
