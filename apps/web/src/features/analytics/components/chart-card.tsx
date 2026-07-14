import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isEditableTarget } from '@/lib/use-hotkeys'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

/**
 * The wrapper every graph shares (spec §9): a header (title · window label ·
 * Graphe/Tableau toggle), the plot slot, and the refetch treatment (hold the
 * previous frame at reduced opacity, never a skeleton flash). It is a focusable
 * region; `t` toggles graph/table while it has focus.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  toolbar,
  isFetching,
  showToggle = true,
  className,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  /** The table twin (spec §1.4). Omitted for the low-data/empty case. */
  table?: ReactNode
  /** Extra header controls to the left of the toggle (e.g. the year stepper). */
  toolbar?: ReactNode
  isFetching?: boolean
  showToggle?: boolean
  className?: string
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const labelId = useId()
  const canToggle = showToggle && table !== undefined

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!canToggle) return
    if (e.key.toLowerCase() !== 't' || e.metaKey || e.ctrlKey || e.altKey) return
    if (isEditableTarget(e.target)) return
    e.preventDefault()
    setView((v) => (v === 'chart' ? 'table' : 'chart'))
  }

  return (
    <section
      aria-labelledby={labelId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn('rounded-md bg-surface-2 p-4', className)}
    >
      {/* Stack under sm so the title keeps its own line instead of being
          truncated to "A." by the toolbar/toggle (fix-mobile-shell §heatmap). */}
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0">
          <h2 id={labelId} className="truncate text-lg font-semibold tracking-[-0.01em] text-text">
            {title}
          </h2>
          {subtitle && (
            <p className="font-mono text-2xs uppercase tracking-[0.08em] text-text-faint">
              sur {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {toolbar}
          {canToggle && (
            <div
              role="tablist"
              aria-label="Affichage"
              className="flex items-center gap-0.5 rounded-md bg-surface-3 p-0.5"
            >
              <ToggleButton active={view === 'chart'} onClick={() => setView('chart')}>
                Graphe
              </ToggleButton>
              <ToggleButton active={view === 'table'} onClick={() => setView('table')}>
                Tableau
              </ToggleButton>
              <Kbd className="ml-1 mr-0.5 border-transparent bg-transparent">t</Kbd>
            </div>
          )}
        </div>
      </header>
      <div
        className={cn(
          'transition-opacity duration-base',
          isFetching ? 'opacity-50' : 'opacity-100',
        )}
      >
        {canToggle && view === 'table' ? table : children}
      </div>
    </section>
  )
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-sm px-2 py-0.5 text-xs font-medium transition-colors duration-fast',
        active ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  )
}
