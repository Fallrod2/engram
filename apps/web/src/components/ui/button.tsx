import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Button — variants mapped to the engram token system (spec §8):
 *   default=accent · secondary=surface-2 · ghost · outline · destructive=danger.
 * Focus is the global double-ring indigo (see styles.css :focus-visible).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium tracking-[-0.005em] transition-colors duration-fast ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        // AA variant B: buttons use the dedicated deep `-fill` tokens; `accent`
        // itself (text, focus ring, progress, switch) is untouched.
        default:
          'bg-accent-fill text-accent-fg hover:bg-accent-fill-hover active:bg-accent-fill-active',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3',
        ghost: 'text-text hover:bg-surface-2',
        outline: 'border border-border bg-transparent text-text hover:bg-surface-2',
        destructive: 'bg-danger-fill text-danger-fg hover:bg-danger-fill-hover',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-9 px-4',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button, buttonVariants }
