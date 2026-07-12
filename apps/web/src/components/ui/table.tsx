import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Dense table primitives (spec §1.8). Header is 2xs UPPERCASE text-faint, rows
 * are borderless with a `surface-2` hover; the FSRS/data language lives in the
 * cells, not in chrome.
 */
function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full caption-bottom border-separate border-spacing-0 text-sm', className)}
      {...props}
    />
  )
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn(className)} {...props} />
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn(className)} {...props} />
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'group/tr relative outline-none transition-colors duration-fast',
        'hover:bg-surface-2 data-[active]:bg-surface-2',
        // Keyboard selection = surface-2 + a 2px accent edge bar (mirrors the
        // nav and the EntityRow list — one selection language across screens).
        'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2',
        'before:rounded-full before:bg-accent before:opacity-0 before:transition-opacity before:duration-fast',
        'data-[active]:before:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-8 px-2 text-left align-middle font-semibold uppercase tracking-[0.08em] text-2xs text-text-faint',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-2 py-2 align-middle', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
