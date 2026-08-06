import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, Unplug } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { cn } from '@/lib/utils'
import { usePlural, useT, type PluralCategory, type TFunction } from '@/lib/i18n'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { SubjectDot } from '@/components/subject-dot'
import { DueCount, DueDot } from '@/components/due-count'
import { subjectsListOptions } from '@/features/subjects/queries'
import { meQuery } from '@/features/admin/queries'
import {
  dueCountsOptions,
  splitBySubjectMap,
  type SubjectDueSplit,
} from '@/features/due-counts/queries'
import { streaksOptions } from '@/features/analytics/queries'
import { useShell } from './shell-context'
import { dueRowLabel } from './due-row-label'
import { NAV_GROUPS, type NavItem } from './nav'
import { StreakPill } from './streak-pill'
import { ThemeToggle } from './theme-toggle'
import { ApiStatus } from './api-status'

export function Sidebar() {
  const { collapsed, canToggleCollapse, toggleCollapse, setCommandOpen } = useShell()
  const t = useT()
  const plural = usePlural()

  const subjectsQuery = useQuery(subjectsListOptions())
  const dueQuery = useQuery(dueCountsOptions())
  // Conditional "Administration" entry (spec §4 + rbac-groups §5, amendment G1).
  // Driven by the SAME shared /api/me cache as the /admin guard (amendment A12)
  // and hidden while pending — so it never flashes in. Visible for an admin OR
  // any delegate (a non-empty permission set), mirroring the route guard.
  const me = useQuery(meQuery()).data
  const isAdmin = me ? me.isAdmin || me.permissions.length > 0 : false

  // Real streak for the footer pill (was hard-coded `days={0}`, spec §5.3bis).
  // A stable `now` keeps the query from churning across renders.
  //
  // T-042 — the handle is kept and only `isSuccess` may feed a number. The pill
  // read `streak?.current ?? 0`, so a failed read said "série de 0 jour": not an
  // omission, an assertion, and the one assertion a streak surface must never
  // make by accident. `undefined` now means unknown, and the pill says so.
  const [streakNow] = useState(() => new Date())
  const streakQuery = useQuery(streaksOptions(streakNow))
  const streak = streakQuery.isSuccess ? streakQuery.data : undefined

  const subjects = useMemo(
    () =>
      (subjectsQuery.data ?? [])
        .filter((s) => !s.archived)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [subjectsQuery.data],
  )
  const dueMap = useMemo(() => splitBySubjectMap(dueQuery.data), [dueQuery.data])
  // T-066 — a failed count read used to keep the mini shimmer up FOR EVER, on
  // every row of a rail that is mounted on every screen. A skeleton is a promise
  // that something is on its way; nothing was. `'unknown'` is the third state
  // (see `DueState`), and it renders as the same em-dash `<DueCount>` already
  // uses for an unknown figure everywhere else.
  const dueUnknown = dueQuery.isError
  /**
   * T-036 — a subject the counts response does not mention reads ZERO, not
   * "still loading".
   *
   * `GET /review/counts` enumerates every non-archived subject, zeros included,
   * so a name that is in the rail but not in that answer is a subject created
   * SINCE it was computed — the optimistic row a fresh "Nouvelle matière" puts
   * up before the counts query has refetched. It necessarily holds no cards.
   * Falling through to `undefined` made that row shimmer next to neighbours
   * showing `·`, so two subjects with the same (empty) backlog looked like two
   * different states, and the newest one looked broken.
   *
   * The skeleton still means what it says: it survives only while the counts
   * query has genuinely not answered yet, in which case NO row has a figure.
   */
  const dueLoaded = dueQuery.data !== undefined
  const dueFor = (subjectId: string): DueState => {
    if (dueUnknown) return 'unknown'
    const split = dueMap.get(subjectId)
    if (split) return split
    return dueLoaded ? { dueCount: 0, overdueCount: 0, todayCount: 0 } : undefined
  }
  // The "Session de révision" row carries the instance-wide split, shaped like a
  // per-subject row so both row kinds share one renderer and one label builder.
  const totalDue: DueState = dueUnknown
    ? 'unknown'
    : dueQuery.data
      ? {
          dueCount: dueQuery.data.total,
          overdueCount: dueQuery.data.overdueCount,
          todayCount: dueQuery.data.todayCount,
        }
      : undefined

  // Ordered list of every focusable entry (nav items + real subjects) → roving.
  //
  // T-067 — the "Matières indisponibles" retry row occupies the subjects' slot
  // when their read failed, so it takes their place HERE too. Left out, it kept
  // its default `tabIndex=0` and became an extra Tab stop in a rail that has
  // exactly one, unreachable by the arrow keys every other row answers to.
  const subjectsFailed = subjectsQuery.isError
  const focusKeys = useMemo(() => {
    const keys: string[] = []
    for (const g of NAV_GROUPS) {
      for (const it of g.items) keys.push(`nav:${it.to}`)
      if (g.id !== 'subjects') continue
      if (subjectsFailed) keys.push(RETRY_KEY)
      else for (const s of subjects) keys.push(`subj:${s.id}`)
    }
    return keys
  }, [subjects, subjectsFailed])
  const retryIndex = focusKeys.indexOf(RETRY_KEY)

  // `HTMLElement`, not `HTMLAnchorElement`: the retry row is a <button>, and it
  // is a rail entry like any other.
  const linkRefs = useRef<(HTMLElement | null)[]>([])
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

      {/* Collapse toggle, collapsed state. The control stays at the TOP in both
          states: expanded it sits in the brand row above, collapsed it becomes
          the first row of the rail. Moving it to the footer made users hunt for
          it where they had just clicked. Geometry mirrors the collapsed search
          button below so the rail column reads as one regular stack. */}
      {collapsed && canToggleCollapse && (
        <div className="px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleCollapse}
                aria-label={t('sidebar.expandAria')}
                className="flex size-8 w-full items-center justify-center rounded-sm text-text-faint transition-colors duration-fast hover:bg-surface-2 hover:text-text"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.expand')}</TooltipContent>
          </Tooltip>
        </div>
      )}

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
          // A ghost shortcut ROW (not a second filled search box): the topbar owns
          // the search-field affordance, so the sidebar entry reads as a coherent
          // keyboard shortcut instead of a duplicate ⌘K control (finding: two
          // identical search inputs at ≥lg). Still opens the palette.
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
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
                    t={t}
                    plural={plural}
                    collapsed={collapsed}
                    showDue={item.to === '/review'}
                    due={item.to === '/review' ? totalDue : undefined}
                    tabIndex={idx === rovingIndex ? 0 : -1}
                    ref={(el) => {
                      linkRefs.current[idx] = el
                    }}
                    onFocus={registerFocus(idx)}
                  />
                )
              })}

              {/* Real subjects (spec §5 item 4). T-042 — three states, not two:
                  `subjectsQuery.data ?? []` made a FAILED read render exactly
                  like an account with no subject at all, on every screen at
                  once, since this rail is mounted everywhere. */}
              {group.id === 'subjects' &&
                (subjectsQuery.isPending ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <SubjectRowSkeleton key={i} collapsed={collapsed} />
                  ))
                ) : subjectsFailed ? (
                  <SubjectsUnavailableRow
                    t={t}
                    collapsed={collapsed}
                    onRetry={() => void subjectsQuery.refetch()}
                    tabIndex={retryIndex === rovingIndex ? 0 : -1}
                    ref={(el) => {
                      linkRefs.current[retryIndex] = el
                    }}
                    onFocus={registerFocus(retryIndex)}
                  />
                ) : (
                  subjects.map((s) => {
                    const idx = focusKeys.indexOf(`subj:${s.id}`)
                    return (
                      <SubjectNavRow
                        key={s.id}
                        subject={s}
                        t={t}
                        plural={plural}
                        due={dueFor(s.id)}
                        collapsed={collapsed}
                        tabIndex={idx === rovingIndex ? 0 : -1}
                        ref={(el) => {
                          linkRefs.current[idx] = el
                        }}
                        onFocus={registerFocus(idx)}
                      />
                    )
                  })
                ))}
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
        {/* Expanded, "Administration" and "Settings" are nav-shaped full-width
            rows: they STACK on the nav group's own `gap-0.5`, like the links
            above them. Side by side they overflowed the 240px bar. Collapsed,
            the centred icon column is unchanged. */}
        <div className={cn('flex flex-col', collapsed ? 'items-center gap-1' : 'gap-0.5')}>
          {isAdmin &&
            (collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/admin"
                    aria-label={t('sidebar.admin')}
                    className="flex size-8 items-center justify-center rounded-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
                  >
                    <ShieldCheck className="size-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sidebar.admin')}</TooltipContent>
              </Tooltip>
            ) : (
              <Link
                to="/admin"
                className="flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text data-[status=active]:bg-accent-subtle data-[status=active]:text-accent"
              >
                <ShieldCheck className="size-4" />
                {t('sidebar.admin')}
              </Link>
            ))}
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
          {collapsed && (
            <StreakPill
              current={streak?.current}
              includesToday={streak?.includesToday ?? false}
              collapsed
            />
          )}
        </div>
        {/* Streak + theme get their own row once expanded, LEADING-aligned. They
            used to be pushed right (`justify-end`) while the links above them
            started at the left inset, so the footer read as a checkerboard. The
            row now starts in the same column as "Réglages": the flame carries the
            links' own `px-2`, so its 16px glyph shares the exact centre line as
            the gear above it. Nothing here can overflow — a 14px pill plus a 32px
            icon button is a third of the 240px bar. */}
        {!collapsed && (
          <div className="flex items-center gap-1">
            <StreakPill current={streak?.current} includesToday={streak?.includesToday ?? false} />
            <ThemeToggle />
          </div>
        )}
        <ApiStatus collapsed={collapsed} />
      </div>
    </aside>
  )
}

/**
 * A due count with its backlog/today split, as both row kinds consume it —
 * derived from the shared API row so the shape has a single source (T-013).
 */
type DueSplit = Omit<SubjectDueSplit, 'subjectId'>

/** A row's counts, or why it has none: `undefined` pending, `'unknown'` failed. */
type DueState = DueSplit | 'unknown' | undefined

/** Roving key of the "Matières indisponibles" row — it stands in for the list. */
const RETRY_KEY = 'subj:unavailable'

/** Shared row chrome: base classes + the 2px indigo active edge bar (spec §5). */
const ROW_CLASS = cn(
  'group/nav relative flex h-8 items-center rounded-sm text-sm text-text-muted',
  'transition-colors duration-fast hover:bg-surface-2 hover:text-text',
  'data-[status=active]:bg-accent-subtle data-[status=active]:text-text',
)
const EDGE_CLASS =
  'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-fast group-data-[status=active]/nav:opacity-100'
/**
 * Collapsed rail: the graduated dot lives in the row's TRAILING GUTTER, not on
 * the icon. Anchored to the icon's top-right corner it overlapped whatever it
 * sat on — at the `mid` and `high` tiers the 8px dot fused with the 8px
 * `SubjectDot` into one bicolour blob and ate a corner of the graduation-cap
 * glyph, so the two signals stopped reading as two. Pushing it further out ran
 * into the other wall: the 32px row has ~8px of vertical slack, and a diagonal
 * offset big enough to clear an icon spills onto the row above (the same trap
 * that had capped the old badge at two characters).
 *
 * The gutter removes the conflict by construction instead of tuning around it:
 * the collapsed row is 48px wide with a 16px icon centred (x ∈ [16,32]), so the
 * dot occupies x ∈ [38,46] at its largest — never within 6px of the icon box or
 * 10px of the subject dot, at any tier, with or without a halo. It is also
 * vertically centred, so no tier can ever reach the row's edge. As a bonus the
 * mark now sits on the same trailing edge as the expanded `DueCount`, so
 * collapsing the sidebar moves it in a straight line instead of jumping.
 */
const DOT_GUTTER = 'absolute inset-y-0 right-0.5'

interface NavLinkProps {
  item: NavItem
  /** Pre-resolved (translated) label; `item.label` is an i18n key. */
  label: string
  t: TFunction
  plural: (count: number) => PluralCategory
  collapsed: boolean
  /** Whether this row carries a due count at all (only "Session de révision"). */
  showDue: boolean
  /** The split, or the reason there is none (pending vs failed). */
  due: DueState
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLAnchorElement | null) => void
}

/** A static nav row: active = accent-subtle + 2px indigo edge bar (spec §5). */
function NavLink({
  item,
  label,
  t,
  plural,
  collapsed,
  showDue,
  due,
  tabIndex,
  onFocus,
  ref,
}: NavLinkProps) {
  const Icon = item.icon
  // One sentence, both states (T-017): collapsed the digits are gone entirely,
  // expanded they are a two-part number — neither is something a screen reader
  // should have to reconstruct, so the row spells it out itself.
  const name = showDue ? dueRowLabel(t, plural, label, due) : label
  const counts = typeof due === 'object' ? due : undefined
  const row = (
    <Link
      ref={ref}
      to={item.to}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={collapsed || showDue ? name : undefined}
      className={cn(ROW_CLASS, collapsed ? 'justify-center px-0' : 'gap-2 px-2')}
    >
      <span className={EDGE_CLASS} aria-hidden />
      <span className="flex items-center justify-center">
        <Icon className="size-4 shrink-0" />
      </span>
      {collapsed && showDue && counts && (
        <DueDot value={counts.dueCount} overdue={counts.overdueCount} className={DOT_GUTTER} />
      )}
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {showDue && (
            <span className="ml-auto">
              <RowCount due={due} />
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
      {/* The tooltip used to repeat the bare label, which told a collapsed-rail
          user nothing about the dot they were pointing at. It now carries the
          same sentence as the accessible name. */}
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  )
}

interface SubjectNavRowProps {
  subject: Subject
  t: TFunction
  plural: (count: number) => PluralCategory
  /** The split, or the reason there is none (pending vs failed). */
  due: DueState
  collapsed: boolean
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLAnchorElement | null) => void
}

/** A real subject row in the Matières group (spec §5 item 4). */
function SubjectNavRow({
  subject,
  t,
  plural,
  due,
  collapsed,
  tabIndex,
  onFocus,
  ref,
}: SubjectNavRowProps) {
  const name = dueRowLabel(t, plural, subject.name, due)
  const counts = typeof due === 'object' ? due : undefined
  const row = (
    <Link
      ref={ref}
      to="/subjects/$subjectId"
      params={{ subjectId: subject.id }}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={name}
      className={cn(ROW_CLASS, collapsed ? 'justify-center px-0' : 'gap-2 px-2')}
    >
      <span className={EDGE_CLASS} aria-hidden />
      <span className="flex items-center justify-center">
        <SubjectDot color={subject.color} />
      </span>
      {collapsed && counts && (
        <DueDot value={counts.dueCount} overdue={counts.overdueCount} className={DOT_GUTTER} />
      )}
      {!collapsed && (
        <>
          <span className="truncate">{subject.name}</span>
          <span className="ml-auto">
            <RowCount due={due} colorHex={subject.color} />
          </span>
        </>
      )}
    </Link>
  )
  if (!collapsed) return row
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The Matières group when its read failed (T-042). Deliberately row-shaped and
 * as quiet as the rest of the rail — a failure here is not the user's business
 * to fix, only to be told about — but it is a BUTTON: the rail is the only
 * place in the shell from which this list can be asked for again.
 */
function SubjectsUnavailableRow({
  t,
  collapsed,
  onRetry,
  tabIndex,
  onFocus,
  ref,
}: {
  t: TFunction
  collapsed: boolean
  onRetry: () => void
  tabIndex: number
  onFocus: () => void
  ref: (el: HTMLButtonElement | null) => void
}) {
  const label = t('sidebar.subjectsUnavailable')
  const button = (
    <button
      ref={ref}
      type="button"
      onClick={onRetry}
      tabIndex={tabIndex}
      onFocus={onFocus}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex h-8 items-center rounded-sm text-sm text-text-faint',
        'transition-colors duration-fast hover:bg-surface-2 hover:text-text',
        collapsed ? 'w-full justify-center px-0' : 'gap-2 px-2',
      )}
    >
      <Unplug className="size-4 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="truncate text-xs">{label}</span>}
    </button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The trailing figure of a nav row, in its three states (T-066).
 *
 * The shimmer used to cover two of them: pending AND failed. It is a promise
 * that a number is coming, and on a dropped request nothing ever came — the rail
 * shimmered until the next reload, on every screen, because it is mounted on all
 * of them. `'unknown'` now falls through to the em-dash `<DueCount>` already
 * renders for an unreadable figure, so "not yet" and "not at all" stop looking
 * alike. The row's accessible name carries the same distinction (`dueRowLabel`).
 */
function RowCount({ due, colorHex }: { due: DueState; colorHex?: string }) {
  if (due === undefined) return <Skeleton className="h-2.5 w-3 rounded-sm" />
  if (due === 'unknown') return <DueCount value={undefined} label={null} />
  return (
    <DueCount
      value={due.dueCount}
      overdue={due.overdueCount}
      {...(colorHex ? { colorHex } : {})}
      label={null}
    />
  )
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
