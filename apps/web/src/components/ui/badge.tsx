import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge — counts and subject tags. Semantic variants use the `-subtle` fills
 * (spec §1 triplets); FSRS rating colors are reserved for their ratings.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs font-medium tracking-[-0.005em] whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-accent-subtle text-accent',
        neutral: 'bg-surface-2 text-text-muted',
        outline: 'border border-border text-text-muted',
        success: 'bg-success-subtle text-success',
        warning: 'bg-warning-subtle text-warning',
        danger: 'bg-danger-subtle text-danger',
        info: 'bg-info-subtle text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span'
  return <Comp className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
