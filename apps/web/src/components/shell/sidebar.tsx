import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PanelLeftClose, PanelLeftOpen, Search, Settings } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SubjectDot } from '@/components/subject-dot'
import { DueBadge, DueCount } from '@/components/due-count'
import { subjectsListOptions } from '@/features/subjects/queries'
import { dueCountsOptions, bySubjectMap } from '@/features/due-counts/queries'
import { streaksOptions } from '@/features/analytics/queries'
import { useShell } from './shell-context'
import { NAV_GROUPS, type NavItem } from './nav'
import { StreakPill } from './streak-pill'
import { ThemeToggle } from './theme-toggle'
import { ApiStatus } from './api-status'

export function Sidebar() {
  const { collapsed, canToggleCollapse, toggleCollapse, setCommandOpen } = useShell()
  const t = useT()

  const subjectsQuery = useQuery(subjectsListOptions())
  const dueQuery = useQuery(dueCountsOptions())
  const dueLoading = dueQuery.isPending

  // Real streak for the footer pill (was hard-coded `days={0}`, spec §5.3bis).
  // A stable `now` keeps the query from churning across renders.
  const [streakNow] = useState(() => new Date())
  const streak = useQuery(streaksOptions(streakNow)).data

  const subjects = useMemo(
    () =>
      (subjectsQuery.data ?? [])
        .filter((s) => !s.archived)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [subjectsQuery.data],
  )
  const dueMap = useMemo(() => bySubjectMap(dueQuery.data), [dueQuery.data])
  const totalDue = dueQuery.data?.total

  // Ordered list of every focusable entry (nav items + real subjects) → roving.
  const focusKeys = useMemo(() => {
    const keys: string[] = []
    for (const g of NAV_GROUPS) {
      for (const it of g.items) keys.push(`nav:${it.to}`)
      if (g.id === 'subjects') for (const s of subjects) keys.push(`subj:${s.id}`)
    }
    return keys
  }, [subjects])

  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const [rovingIndex, setRovingIndex] = useState(0)
  const rovingIndexRef = useRef(0)
  rovingIndexRef.current = rovingIndex

  const onNavKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const count = focusKeys.length
      if (count === 0) return
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
    },
    [focusKeys.length],
  )

  const registerFocus = (idx: number) => () => {
    rovingIndexRef.current = idx
    setRovingIndex(idx)
  }

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
                    aria-label={t('sidebar.collapseAria')}
                    className="ml-auto flex size-6 items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
                  >
                    <PanelLeftClose className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t('sidebar.collapse')} <Kbd className="ml-1">[</Kbd>
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
                aria-label={t('sidebar.search')}
                className="flex size-8 w-full items-center justify-center rounded-sm bg-surface-2 text-text-faint transition-colors duration-fast hover:bg-surface-3 hover:text-text"
              >
                <Search className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('sidebar.search')} <Kbd className="ml-1">⌘K</Kbd>
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-sm bg-surface-2 px-2.5 text-text-faint transition-colors duration-fast hover:bg-surface-3"
          >
            <Search className="size-4 shrink-0" />
            <span className="text-sm">{t('sidebar.searchPlaceholder')}</span>
            <Kbd className="ml-auto">⌘K</Kbd>
          </button>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <nav
          aria-label={t('nav.aria.mainNav')}
          onKeyDown={onNavKeyDown}
          className={cn('flex flex-col gap-4 px-3 py-2', collapsed && 'px-2')}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-0.5">
              {collapsed ? (
                <Separator className="mx-auto my-1 w-6" />
              ) : (
                <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
                  {t(group.label)}
                </p>
              )}

              {group.items.map((item) => {
                const idx = focusKeys.indexOf(`nav:${item.to}`)
                return (
                  <NavLink
                    key={item.to}
                    item={item}
                    label={t(item.label)}
                    collapsed={collapsed}
                    count={item.to === '/review' ? totalDue : undefined}
                    countLoading={item.to === '/review' && dueLoading}
                    tabIndex={idx === rovingIndex ? 0 : -1}
                    ref={(el) => {
                      linkRefs.current[idx] = el
                    }}
                    onFocus={registerFocus(idx)}
                  />
                )
              })}

              {/* Real subjects (spec §5 item 4). */}
              {group.id === 'subjects' &&
                (subjectsQuery.isPending
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <SubjectRowSkeleton key={i} collapsed={collapsed} />
                    ))
                  : subjects.map((s) => {
                      const idx = focusKeys.indexOf(`subj:${s.id}`)
                      return (
                        <SubjectNavRow
                          key={s.id}
                          subject={s}
                          due={dueMap.get(s.id) ?? 0}
                          dueLoading={dueLoading}
                          collapsed={collapsed}
                          tabIndex={idx === rovingIndex ? 0 : -1}
                          ref={(el) => {
                            linkRefs.current[idx] = el
                          }}
                          onFocus={registerFocus(idx)}
                        />
                      )
                    }))}
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
                  aria-label={t('sidebar.settings')}
                  className="flex size-8 items-center justify-center rounded-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
                >
                  <Settings className="size-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{t('sidebar.settings')}</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              to="/settings"
              className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
            >
              <Settings className="size-4" />
              {t('sidebar.settings')}
            </Link>
          )}
          <div className={cn('ml-auto flex items-center gap-1', collapsed && 'ml-0 flex-col')}>
            <StreakPill
              current={streak?.current ?? 0}
              includesToday={streak?.includesToday ?? false}
              collapsed={collapsed}
            />
            {canToggleCollapse && collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleCollapse}
                    aria-label={t('sidebar.expandAria')}
                    className="flex size-8 items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
                  >
                    <PanelLeftOpen className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.expand')}</TooltipContent>
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
  /** Pre-resolved (translated) label; `item.label` is an i18n key. */
  label: string
  collapsed: boolean
  count: number | undefined
  countLoading: boolean
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLAnchorElement | null) => void
}

/** A static nav row: active = accent-subtle + 2px indigo edge bar (spec §5). */
function NavLink({
  item,
  label,
  collapsed,
  count,
  countLoading,
  tabIndex,
  onFocus,
  ref,
}: NavLinkProps) {
  const Icon = item.icon
  const row = (
    <Link
      ref={ref}
      to={item.to}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group/nav relative flex h-8 items-center rounded-sm text-sm text-text-muted',
        'transition-colors duration-fast hover:bg-surface-2 hover:text-text',
        'data-[status=active]:bg-accent-subtle data-[status=active]:text-text',
        collapsed ? 'justify-center px-0' : 'gap-2 px-2',
      )}
    >
      <span
        className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-fast group-data-[status=active]/nav:opacity-100"
        aria-hidden
      />
      <span className="relative flex items-center justify-center">
        <Icon className="size-4 shrink-0" />
        {collapsed && count != null && (
          <DueBadge value={count} className="absolute -right-2 -top-2" />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {count != null && (
            <span className="ml-auto">
              {countLoading ? <CountShimmer /> : <DueCount value={count} />}
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
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

interface SubjectNavRowProps {
  subject: Subject
  due: number
  dueLoading: boolean
  collapsed: boolean
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLAnchorElement | null) => void
}

/** A real subject row in the Matières group (spec §5 item 4). */
function SubjectNavRow({
  subject,
  due,
  dueLoading,
  collapsed,
  tabIndex,
  onFocus,
  ref,
}: SubjectNavRowProps) {
  const row = (
    <Link
      ref={ref}
      to="/subjects/$subjectId"
      params={{ subjectId: subject.id }}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={collapsed ? subject.name : undefined}
      className={cn(
        'group/nav relative flex h-8 items-center rounded-sm text-sm text-text-muted',
        'transition-colors duration-fast hover:bg-surface-2 hover:text-text',
        'data-[status=active]:bg-accent-subtle data-[status=active]:text-text',
        collapsed ? 'justify-center px-0' : 'gap-2 px-2',
      )}
    >
      <span
        className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-fast group-data-[status=active]/nav:opacity-100"
        aria-hidden
      />
      <span className="relative flex items-center justify-center">
        <SubjectDot color={subject.color} />
        {collapsed && <DueBadge value={due} className="absolute -right-2 -top-2" />}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{subject.name}</span>
          <span className="ml-auto">
            {dueLoading ? <CountShimmer /> : <DueCount value={due} colorHex={subject.color} />}
          </span>
        </>
      )}
    </Link>
  )
  if (!collapsed) return row
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{subject.name}</TooltipContent>
    </Tooltip>
  )
}

/** 12×10px mini shimmer for a pending due count (spec §1.6). */
function CountShimmer() {
  return <Skeleton className="h-2.5 w-3 rounded-sm" />
}

function SubjectRowSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-sm',
        collapsed ? 'justify-center' : 'gap-2 px-2',
      )}
      aria-hidden
    >
      <Skeleton className="size-2 rounded-full" />
      {!collapsed && (
        <>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="ml-auto h-2.5 w-3" />
        </>
      )}
    </div>
  )
}
