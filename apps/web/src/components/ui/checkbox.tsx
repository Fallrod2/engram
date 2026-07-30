import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Checkbox — a NATIVE input, restyled.
 *
 * shadcn ships a Radix checkbox; this one is deliberately not it. A native
 * `<input type="checkbox">` already does everything a dense multi-select table
 * needs — Space toggles it, `indeterminate` is a real DOM property, screen
 * readers announce "checked / mixed" with no ARIA of our own — and it adds no
 * dependency for a control whose entire job is a 16px box. The appearance is
 * stripped and rebuilt so it still reads as the design system's.
 *
 * `indeterminate` is the header state: SOME rows of this page are selected. It
 * cannot be expressed as a prop in HTML, hence the ref.
 */
export function Checkbox({
  checked,
  indeterminate,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<'input'>, 'type' | 'checked' | 'onChange'> & {
  checked: boolean
  indeterminate?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate === true
  }, [indeterminate])

  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-xs border border-border-strong bg-surface-2',
          'transition-colors duration-fast hover:border-accent',
          'checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-accent-fg opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute size-3 text-accent-fg opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  )
}
