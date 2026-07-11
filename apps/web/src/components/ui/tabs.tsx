import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-md bg-surface-2 p-1 text-text-muted',
        className,
      )}
      {...props}
    />
  )
}

/** Active tab lifts to surface-3 + primary text; no accent fill (spec discipline). */
function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-sm font-medium',
        'transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-surface-3 data-[state=active]:text-text hover:text-text',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
