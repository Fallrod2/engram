import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

/** Switch — theme toggle + boolean settings. Checked = accent track. */
function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent',
        'transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-text shadow-sm ring-0',
          'transition-transform duration-fast ease-out data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5',
          'data-[state=checked]:bg-accent-fg',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
