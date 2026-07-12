import { cn } from '@/lib/utils'
import { formatCountdown } from '@/lib/format'

/**
 * Exam countdown in mono (spec §1.8). Urgency reads from PROXIMITY, never color
 * — there is no red, even at J-0/J-1:
 *   passé → text-faint · aujourd'hui → text (accent when it is today) · J-n → text-muted.
 */
export function Countdown({
  dateIso,
  now,
  className,
}: {
  dateIso: string
  now?: Date
  className?: string
}) {
  const label = formatCountdown(dateIso, now)
  const tone =
    label === 'passé'
      ? 'text-text-faint'
      : label === "aujourd'hui"
        ? 'text-accent'
        : 'text-text-muted'
  return <span className={cn('font-mono text-xs tabular-nums', tone, className)}>{label}</span>
}
