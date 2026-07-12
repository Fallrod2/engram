import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * In-content screen header: an optional breadcrumb line, the entity title, and
 * right-aligned actions. The global shell header carries the section name; this
 * carries the specific page (spec §2/§3/§4).
 */
export function PageHeader({
  breadcrumb,
  title,
  actions,
  className,
}: {
  breadcrumb?: ReactNode
  title: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex items-start gap-3', className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 flex items-center gap-1.5 text-xs">{breadcrumb}</div>}
        <h1 className="flex items-center gap-2 truncate text-xl font-semibold tracking-[-0.02em] text-text">
          {title}
        </h1>
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A right-pointing separator for breadcrumb segments. */
export function Crumb({ children }: { children: ReactNode }) {
  return <span className="text-text-muted">{children}</span>
}
