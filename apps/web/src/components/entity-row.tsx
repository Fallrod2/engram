import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Dense generic row (spec §1.10): 44px, transparent on `bg`, hover `surface-2`,
 * keyboard-selected = `surface-2` + a 2px accent edge bar (mirrors the nav).
 *
 * The interactive element (a typed `<Link>`) carries `entityRowClass` and the
 * roving `data-active` attribute; `EntityRow` wraps it so hover-revealed
 * actions can sit outside the anchor (nested interactives are invalid HTML).
 */
export function entityRowClass(className?: string): string {
  return cn(
    'group/row-link relative flex h-11 items-center gap-3 rounded-sm pl-3 pr-2',
    'text-left transition-colors duration-fast ease-out',
    'hover:bg-surface-2 data-[active]:bg-surface-2',
    // Accent edge bar on keyboard selection.
    'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2',
    'before:rounded-full before:bg-accent before:opacity-0 before:transition-opacity before:duration-fast',
    'data-[active]:before:opacity-100',
    className,
  )
}

/** Row container — reveals its actions slot on hover/focus-within. */
export function EntityRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('group/row relative', className)}>{children}</li>
}

/** Trailing actions (kebab) revealed on hover/focus (spec §1.10). */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2',
        'opacity-0 transition-opacity duration-fast',
        'group-hover/row:opacity-100 focus-within:opacity-100 [&:has(:focus-visible)]:opacity-100',
        'data-[open=true]:opacity-100',
      )}
    >
      {children}
    </div>
  )
}
