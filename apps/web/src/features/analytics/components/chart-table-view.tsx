import type { ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * The WCAG-clean twin of every chart (spec §1.4): the same data as a dense
 * `<table>`, so any value reachable in a tooltip is also reachable without
 * hover, at the keyboard, by a screen reader. This twin is what lets a chart
 * tolerate a contrast/CVD WARN on its fills — the fallback channel is present.
 */
export interface ChartColumn<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  /** Numeric cells set `mono` for tabular alignment. */
  mono?: boolean
  render: (row: T) => ReactNode
}

export function ChartTableView<T>({
  columns,
  rows,
  rowKey,
  caption,
  maxHeight = 320,
}: {
  columns: readonly ChartColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  caption?: string
  maxHeight?: number
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      {caption && <p className="sr-only">{caption}</p>}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead key={c.key} className={cn(c.align === 'right' && 'text-right')}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    c.align === 'right' && 'text-right',
                    c.mono && 'font-mono text-xs tabular-nums',
                  )}
                >
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
