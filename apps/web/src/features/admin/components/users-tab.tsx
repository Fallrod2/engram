import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShieldMinus,
  Trash2,
  UserCog,
  Pause,
  Play,
  Sparkles,
} from 'lucide-react'
import type { AdminUserSummary } from '@engram/shared'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { useT } from '@/lib/i18n'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { adminUsersOptions, meQuery, useSetDemo, useSetRole, useSetStatus } from '../queries'
import { DeleteUserDialog } from './delete-user-dialog'
import { CreateUserDialog } from './create-user-dialog'
import { EditUserDialog } from './edit-user-dialog'

/** Compact integer formatter (tokens read in the thousands). */
function fmt(n: number): string {
  return n.toLocaleString()
}

export function AdminUsersTab() {
  const t = useT()
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  // Debounce the search so each keystroke does not fire a request.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(rawQuery.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [rawQuery])

  const usersQuery = useQuery({
    ...adminUsersOptions({ query: query || undefined, page, sort: 'lastSeen', dir: 'desc' }),
    placeholderData: keepPreviousData,
  })
  const me = useQuery(meQuery()).data
  const data = usersQuery.data

  const [deleteTarget, setDeleteTarget] = useState<AdminUserSummary | null>(null)
  const [editTarget, setEditTarget] = useState<AdminUserSummary | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // Mirror the server gate: creating/editing accounts needs `users.manage` (or
  // admin). The server is the sole authority; this only hides an action that would
  // otherwise 403 (or 503 when Supabase account management is not configured).
  const canManageUsers = me?.isAdmin === true || (me?.permissions.includes('users.manage') ?? false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
          <Input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder={t('admin.users.searchPlaceholder')}
            className="pl-8"
            aria-label={t('admin.users.searchPlaceholder')}
          />
        </div>
        {canManageUsers && (
          <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{t('admin.users.createAccount')}</span>
          </Button>
        )}
      </div>

      {usersQuery.isPending ? (
        <UsersSkeleton />
      ) : !data || data.users.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title={query ? t('admin.users.emptySearch') : t('admin.users.empty')}
        />
      ) : (
        <div className={cn(usersQuery.isFetching && 'opacity-60 transition-opacity duration-base')}>
          {/* Desktop: dense table */}
          <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.users.colUser')}</TableHead>
                  <TableHead>{t('admin.users.colRole')}</TableHead>
                  <TableHead>{t('admin.users.colStatus')}</TableHead>
                  <TableHead className="text-right">{t('admin.users.colCards')}</TableHead>
                  <TableHead className="text-right">{t('admin.users.colGenerations')}</TableHead>
                  <TableHead className="text-right">{t('admin.users.colTokens')}</TableHead>
                  <TableHead>{t('admin.users.colLastSeen')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell>
                      <UserCell user={u} isSelf={u.userId === me?.userId} />
                    </TableCell>
                    <TableCell>
                      <RoleBadge user={u} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge user={u} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-text-muted">
                      {fmt(u.cards)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-text-muted">
                      {fmt(u.generations)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-text-muted">
                      {fmt(u.tokens)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-text-muted">
                      {formatRelativeTime(u.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      <RowActions
                        user={u}
                        isSelf={u.userId === me?.userId}
                        onDelete={() => setDeleteTarget(u)}
                        onEdit={() => setEditTarget(u)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {data.users.map((u) => (
              <li
                key={u.userId}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <UserCell user={u} isSelf={u.userId === me?.userId} />
                  <RowActions
                    user={u}
                    isSelf={u.userId === me?.userId}
                    onDelete={() => setDeleteTarget(u)}
                    onEdit={() => setEditTarget(u)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <RoleBadge user={u} />
                  <StatusBadge user={u} />
                </div>
                <div className="flex gap-4 font-mono text-2xs tabular-nums text-text-muted">
                  <span>
                    {t('admin.users.colCards')}: {fmt(u.cards)}
                  </span>
                  <span>
                    {t('admin.users.colGenerations')}: {fmt(u.generations)}
                  </span>
                  <span>
                    {t('admin.users.colTokens')}: {fmt(u.tokens)}
                  </span>
                </div>
                <span className="text-2xs text-text-faint">{formatRelativeTime(u.lastSeenAt)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
            <span>{t('admin.users.results', { count: data.total })}</span>
            {data.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                  <span className="sr-only sm:not-sr-only">{t('admin.users.prev')}</span>
                </Button>
                <span className="tabular-nums">
                  {t('admin.users.pageLabel', { page: data.page, total: data.totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <span className="sr-only sm:not-sr-only">{t('admin.users.next')}</span>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <DeleteUserDialog
        user={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />
      <EditUserDialog user={editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />
      {createOpen && <CreateUserDialog onOpenChange={setCreateOpen} />}
    </div>
  )
}

function UserCell({ user, isSelf }: { user: AdminUserSummary; isSelf: boolean }) {
  const t = useT()
  const primary = user.email ?? user.userId
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 truncate text-sm text-text">
        <span className="truncate">{user.email ?? shortId(user.userId)}</span>
        {isSelf && <Badge variant="neutral">{t('admin.users.you')}</Badge>}
        {user.isDemo && <Badge variant="info">{t('admin.users.demoBadge')}</Badge>}
      </span>
      {user.email && (
        <span className="truncate font-mono text-2xs text-text-faint">{shortId(user.userId)}</span>
      )}
      {!user.email && <span className="sr-only">{primary}</span>}
      {user.groups.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1">
          {user.groups.map((g) => (
            <Badge key={g.id} variant="outline">
              {g.name}
            </Badge>
          ))}
        </span>
      )}
    </div>
  )
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

function RoleBadge({ user }: { user: AdminUserSummary }) {
  const t = useT()
  return user.role === 'admin' ? (
    <Badge variant="default">{t('admin.users.roleAdmin')}</Badge>
  ) : (
    <Badge variant="neutral">{t('admin.users.roleUser')}</Badge>
  )
}

function StatusBadge({ user }: { user: AdminUserSummary }) {
  const t = useT()
  return user.status === 'suspended' ? (
    <Badge variant="danger">{t('admin.users.statusSuspended')}</Badge>
  ) : (
    <Badge variant="success">{t('admin.users.statusActive')}</Badge>
  )
}

function RowActions({
  user,
  isSelf,
  onDelete,
  onEdit,
}: {
  user: AdminUserSummary
  isSelf: boolean
  onDelete: () => void
  onEdit: () => void
}) {
  const t = useT()
  const setRole = useSetRole()
  const setStatus = useSetStatus()
  const setDemo = useSetDemo()
  const me = useQuery(meQuery()).data

  // Mirror the SERVER guards AND the caller's permissions (rbac-groups, amendment
  // G1) so the UI never offers an action the server would 403. role/demo/delete
  // stay admin-only (requireAdmin); suspend/reactivate are delegable (users.manage).
  const isAdmin = me?.isAdmin === true
  const canManageUsers = isAdmin || (me?.permissions.includes('users.manage') ?? false)
  const canPromote = isAdmin && user.role === 'user' && !user.isDemo
  const canDemote = isAdmin && user.role === 'admin' && !isSelf
  const canSuspend = canManageUsers && user.status === 'active' && !isSelf
  const canReactivate = canManageUsers && user.status === 'suspended'
  const canSetDemo = isAdmin && !user.isDemo && user.role !== 'admin'
  const canUnsetDemo = isAdmin && user.isDemo
  const canDelete = isAdmin && !isSelf && !user.isDemo
  // Editing the email is a `users.manage` capability (parity with the server, A11).
  const canEdit = canManageUsers

  const hasAny =
    canEdit ||
    canPromote ||
    canDemote ||
    canSuspend ||
    canReactivate ||
    canSetDemo ||
    canUnsetDemo ||
    canDelete
  if (!hasAny) return null

  const success = (msg: string) => ({ onSuccess: () => toast.success(msg) })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t('admin.users.actionsAria')}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-4" />
            {t('admin.users.edit')}
          </DropdownMenuItem>
        )}
        {canPromote && (
          <DropdownMenuItem
            onClick={() =>
              setRole.mutate(
                { userId: user.userId, role: 'admin' },
                success(t('admin.toasts.roleUpdated')),
              )
            }
          >
            <ShieldCheck className="size-4" />
            {t('admin.users.promote')}
          </DropdownMenuItem>
        )}
        {canDemote && (
          <DropdownMenuItem
            onClick={() =>
              setRole.mutate(
                { userId: user.userId, role: 'user' },
                success(t('admin.toasts.roleUpdated')),
              )
            }
          >
            <ShieldMinus className="size-4" />
            {t('admin.users.demote')}
          </DropdownMenuItem>
        )}
        {canSuspend && (
          <DropdownMenuItem
            onClick={() =>
              setStatus.mutate(
                { userId: user.userId, status: 'suspended' },
                success(t('admin.toasts.statusUpdated')),
              )
            }
          >
            <Pause className="size-4" />
            {t('admin.users.suspend')}
          </DropdownMenuItem>
        )}
        {canReactivate && (
          <DropdownMenuItem
            onClick={() =>
              setStatus.mutate(
                { userId: user.userId, status: 'active' },
                success(t('admin.toasts.statusUpdated')),
              )
            }
          >
            <Play className="size-4" />
            {t('admin.users.reactivate')}
          </DropdownMenuItem>
        )}
        {(canSetDemo || canUnsetDemo) && (
          <DropdownMenuItem
            onClick={() =>
              setDemo.mutate(
                { userId: user.userId, isDemo: !user.isDemo },
                success(t('admin.toasts.demoUpdated')),
              )
            }
          >
            <Sparkles className="size-4" />
            {user.isDemo ? t('admin.users.unsetDemo') : t('admin.users.setDemo')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:text-danger" onClick={onDelete}>
              <Trash2 className="size-4" />
              {t('admin.users.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UsersSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  )
}
