import { useCallback, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useShell } from './shell-context'
import { FLAT_NAV, NAV_GROUPS, SUBJECT_PREVIEW, type NavItem } from './nav'
import { SubjectDot } from './subject-dot'
import { DueCount } from './due-count'
import { StreakPill } from './streak-pill'
import { ThemeToggle } from './theme-toggle'
import { ApiStatus } from './api-status'

/** Flat index of a nav item, for roving tabindex + ⌘1…9 parity. */
function flatIndexOf(item: NavItem): number {
  return FLAT_NAV.findIndex((n) => n.to === item.to)
}

export function Sidebar() {
  const { collapsed, canToggleCollapse, toggleCollapse, setCommandOpen } = useShell()
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const [rovingIndex, setRovingIndex] = useState(0)

  // Roving tabindex: arrows move focus within the nav; Enter follows the link.
  const onNavKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const count = FLAT_NAV.length
    let next: number | null = null
    if (e.key === 'ArrowDown') next = (rovingIndexRef.current + 1) % count
    else if (e.key === 'ArrowUp') next = (rovingIndexRef.current - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    if (next === null) return
    e.preventDefault()
    rovingIndexRef.current = next
    setRovingIndex(next)
    linkRefs.current[next]?.focus()
  }, [])

  // Keep a ref mirror so the stable keydown handler reads the latest index.
  const rovingIndexRef = useRef(0)
  rovingIndexRef.current = rovingIndex

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar flex h-full shrink-0 flex-col border-r border-border bg-surface-1',
        'transition-[width] duration-base ease-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn('flex h-12 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-accent text-accent-fg"
          aria-hidden
        >
          <span className="text-2xs">◆</span>
        </span>
        {!collapsed && (
          <>
            <span className="text-sm font-semibold tracking-[-0.01em] text-text">engram</span>
            {canToggleCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    aria-label="Réduire la barre latérale"
                    className="ml-auto flex size-6 items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
                  >
                    <PanelLeftClose className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  Réduire <Kbd className="ml-1">[</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* Search / ⌘K */}
      <div className={cn('px-3 pb-2', collapsed && 'px-2')}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                aria-label="Rechercher"
                className="flex size-8 w-full items-center justify-center rounded-sm bg-surface-2 text-text-faint transition-colors duration-fast hover:bg-surface-3 hover:text-text"
              >
                <Search className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Rechercher <Kbd className="ml-1">⌘K</Kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-sm bg-surface-2 px-2.5 text-text-faint transition-colors duration-fast hover:bg-surface-3"
          >
            <Search className="size-4 shrink-0" />
            <span className="text-sm">Rechercher…</span>
            <Kbd className="ml-auto">⌘K</Kbd>
          </button>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav
          aria-label="Navigation principale"
          onKeyDown={onNavKeyDown}
          className={cn('flex flex-col gap-4 px-3 py-2', collapsed && 'px-2')}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              {collapsed ? (
                <Separator className="mx-auto my-1 w-6" />
              ) : (
                <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
                  {group.label}
                </p>
              )}

              {group.items.map((item) => {
                const idx = flatIndexOf(item)
                return (
                  <NavLink
                    key={item.to}
                    item={item}
                    collapsed={collapsed}
                    tabIndex={idx === rovingIndex ? 0 : -1}
                    ref={(el) => {
                      linkRefs.current[idx] = el
                    }}
                    onFocus={() => {
                      rovingIndexRef.current = idx
                      setRovingIndex(idx)
                    }}
                  />
                )
              })}

              {/* Subject preview rows (static, Phase 0). */}
              {group.id === 'subjects' &&
                SUBJECT_PREVIEW.map((s) =>
                  collapsed ? (
                    <Tooltip key={s.label}>
                      <TooltipTrigger asChild>
                        <div
                          className="flex h-8 items-center justify-center rounded-sm"
                          aria-hidden
                        >
                          <SubjectDot subject={s.subject} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right">{s.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <div
                      key={s.label}
                      className="flex h-8 items-center gap-2 rounded-sm px-2 text-text-muted"
                      aria-hidden
                    >
                      <SubjectDot subject={s.subject} />
                      <span className="truncate text-sm">{s.label}</span>
                      <span className="ml-auto">
                        <DueCount count={s.count} subject={s.subject} />
                      </span>
                    </div>
                  ),
                )}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div
        className={cn(
          'flex flex-col gap-2 border-t border-border p-3',
          collapsed && 'items-center px-2',
        )}
      >
        <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/settings"
                  aria-label="Réglages"
                  className="flex size-8 items-center justify-center rounded-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
                >
                  <Settings className="size-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Réglages</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              to="/settings"
              className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
            >
              <Settings className="size-4" />
              Réglages
            </Link>
          )}
          <div className={cn('ml-auto flex items-center gap-1', collapsed && 'ml-0 flex-col')}>
            <StreakPill days={0} collapsed={collapsed} />
            {canToggleCollapse && collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    aria-label="Déployer la barre latérale"
                    className="flex size-8 items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
                  >
                    <PanelLeftOpen className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Déployer</TooltipContent>
              </Tooltip>
            )}
            {!collapsed && <ThemeToggle />}
          </div>
        </div>
        <ApiStatus collapsed={collapsed} />
      </div>
    </aside>
  )
}

interface NavLinkProps {
  item: NavItem
  collapsed: boolean
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLAnchorElement | null) => void
}

/** A single nav row: active = accent-subtle + 2px indigo edge bar (spec §5). */
function NavLink({ item, collapsed, tabIndex, onFocus, ref }: NavLinkProps) {
  const Icon = item.icon

  const row = (
    <Link
      ref={ref}
      to={item.to}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'group/nav relative flex h-8 items-center rounded-sm text-sm text-text-muted',
        'transition-colors duration-fast hover:bg-surface-2 hover:text-text',
        'data-[status=active]:bg-accent-subtle data-[status=active]:text-text',
        collapsed ? 'justify-center px-0' : 'gap-2 px-2',
      )}
    >
      {/* Active edge bar */}
      <span
        className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-fast group-data-[status=active]/nav:opacity-100"
        aria-hidden
      />
      <span className="relative flex items-center justify-center">
        {item.subject ? (
          <SubjectDot subject={item.subject} />
        ) : (
          <Icon className="size-4 shrink-0" />
        )}
        {/* Collapsed: due count becomes a micro badge (spec §5). */}
        {collapsed && item.count != null && item.count > 0 && (
          <span className="absolute -right-2 -top-2 flex min-w-3.5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] leading-none text-accent-fg">
            {item.count}
          </span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {item.count != null && (
            <span className="ml-auto">
              <DueCount count={item.count} subject={item.subject} />
            </span>
          )}
        </>
      )}
    </Link>
  )

  if (!collapsed) return row

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
