import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * In-content screen header: an optional breadcrumb line, the entity title, and
 * right-aligned actions. The global shell header carries the section name; this
 * carries the specific page (spec §2/§3/§4).
 *
 * `title` is optional (spec §4.1): a section-root screen (planning, analytics,
 * subjects/import lists, dashboard) must NOT render an in-page `<h1>` equal to
 * the section title the global header already shows. Such a screen may still use
 * `PageHeader` actions-only (no `title`) to carry a right-aligned action bar.
 */
export function PageHeader({
  breadcrumb,
  title,
  actions,
  className,
}: {
  breadcrumb?: ReactNode
  title?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    // Below `sm` the header stacks (breadcrumb / title full-width / actions on
    // their own wrapping row) so the title is never squeezed to 0px by the
    // right-aligned action buttons on a phone (fix-mobile-shell §PageHeader).
    <div className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-start', className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 flex items-center gap-1.5 text-xs">{breadcrumb}</div>}
        {title !== undefined && (
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-text">
            {title}
          </h1>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:flex-nowrap">{actions}</div>
      )}
    </div>
  )
}

/** A right-pointing separator for breadcrumb segments. */
export function Crumb({ children }: { children: ReactNode }) {
  return <span className="text-text-muted">{children}</span>
}
