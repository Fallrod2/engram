import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
  UserPlus,
  X,
  Pencil,
  Shield,
} from 'lucide-react'
import { ADMIN_PERMISSIONS, type AdminGroup, type AdminPermission } from '@engram/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { useT, type TKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  adminGroupMembersOptions,
  adminGroupsOptions,
  adminUsersOptions,
  meQuery,
  useAddMember,
  useCreateGroup,
  useDeleteGroup,
  useRemoveMember,
  useSetGroupPermissions,
  useUpdateGroup,
} from '../queries'

/** i18n label key for a permission value ('users.view' → admin.permissions.usersView). */
const PERMISSION_KEY: Record<AdminPermission, TKey> = {
  'users.view': 'admin.permissions.usersView',
  'users.manage': 'admin.permissions.usersManage',
  'groups.manage': 'admin.permissions.groupsManage',
  'audit.view': 'admin.permissions.auditView',
  'stats.view': 'admin.permissions.statsView',
}

export function AdminGroupsTab() {
  const t = useT()
  const groupsQuery = useQuery(adminGroupsOptions())
  const me = useQuery(meQuery()).data
  const isAdmin = me?.isAdmin === true
  // The caller can search the user directory iff they hold `users.view`; a
  // groups.manage-only delegate falls back to the raw user-id input.
  const canSearchUsers = isAdmin || (me?.permissions.includes('users.view') ?? false)

  const [formGroup, setFormGroup] = useState<AdminGroup | null | undefined>(undefined) // null = create
  const [membersGroup, setMembersGroup] = useState<AdminGroup | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<AdminGroup | null>(null)

  const data = groupsQuery.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-faint">{t('admin.groups.subtitle')}</p>
        <Button size="sm" onClick={() => setFormGroup(null)}>
          <Plus className="size-4" />
          {t('admin.groups.new')}
        </Button>
      </div>

      {groupsQuery.isPending ? (
        <GroupsSkeleton />
      ) : !data || data.groups.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={t('admin.groups.empty')}
          meta={t('admin.groups.emptyHint')}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.groups.map((g) => (
            <li
              key={g.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-surface-1 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text">{g.name}</span>
                  {g.description && (
                    <span className="truncate text-xs text-text-muted">{g.description}</span>
                  )}
                </div>
                <GroupActions
                  isAdmin={isAdmin}
                  onEdit={() => setFormGroup(g)}
                  onMembers={() => setMembersGroup(g)}
                  onDelete={() => setDeleteGroupTarget(g)}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {g.permissions.length === 0 ? (
                  <span className="text-2xs text-text-faint">
                    {t('admin.groups.noPermissions')}
                  </span>
                ) : (
                  g.permissions.map((p) => (
                    <Badge key={p} variant="outline">
                      {t(PERMISSION_KEY[p])}
                    </Badge>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={() => setMembersGroup(g)}
                className="flex w-fit items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text"
              >
                <Users className="size-3.5" />
                {t('admin.groups.memberCount', { count: g.memberCount })}
              </button>
            </li>
          ))}
        </ul>
      )}

      {formGroup !== undefined && (
        <GroupFormDialog
          group={formGroup}
          isAdmin={isAdmin}
          onOpenChange={(open) => !open && setFormGroup(undefined)}
        />
      )}
      {membersGroup && (
        <GroupMembersDialog
          group={membersGroup}
          canSearchUsers={canSearchUsers}
          onOpenChange={(open) => !open && setMembersGroup(null)}
        />
      )}
      <DeleteGroupDialog
        group={deleteGroupTarget}
        onOpenChange={() => setDeleteGroupTarget(null)}
      />
    </div>
  )
}

function GroupActions({
  isAdmin,
  onEdit,
  onMembers,
  onDelete,
}: {
  isAdmin: boolean
  onEdit: () => void
  onMembers: () => void
  onDelete: () => void
}) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t('admin.groups.actionsAria')}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="size-4" />
          {isAdmin ? t('admin.groups.edit') : t('admin.groups.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMembers}>
          <Users className="size-4" />
          {t('admin.groups.manageMembers')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger focus:text-danger" onClick={onDelete}>
          <Trash2 className="size-4" />
          {t('admin.groups.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Create (group === null) or edit (group set) a group. Permissions edit is admin-only (A2). */
function GroupFormDialog({
  group,
  isAdmin,
  onOpenChange,
}: {
  group: AdminGroup | null
  isAdmin: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const create = useCreateGroup()
  const update = useUpdateGroup()
  const setPerms = useSetGroupPermissions()

  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [permissions, setPermissions] = useState<AdminPermission[]>(group?.permissions ?? [])

  const isEdit = group !== null
  const busy = create.isPending || update.isPending || setPerms.isPending
  const canSubmit = name.trim().length > 0 && !busy

  function toggle(p: AdminPermission) {
    setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
  }

  async function onSubmit() {
    if (!canSubmit) return
    const trimmed = name.trim()
    const desc = description.trim()
    try {
      if (isEdit) {
        await update.mutateAsync({ id: group.id, name: trimmed, description: desc || null })
        if (isAdmin && !sameSet(permissions, group.permissions)) {
          await setPerms.mutateAsync({ id: group.id, permissions })
        }
        toast.success(t('admin.groups.toastUpdated'))
      } else {
        const created = (await create.mutateAsync({
          name: trimmed,
          ...(desc ? { description: desc } : {}),
        })) as AdminGroup
        if (isAdmin && permissions.length > 0) {
          await setPerms.mutateAsync({ id: created.id, permissions })
        }
        toast.success(t('admin.groups.toastCreated'))
      }
      onOpenChange(false)
    } catch {
      // The mutation hooks already surface a toast on error.
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('admin.groups.editTitle') : t('admin.groups.newTitle')}
          </DialogTitle>
          <DialogDescription>{t('admin.groups.formHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">{t('admin.groups.nameLabel')}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.groups.namePlaceholder')}
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-desc">{t('admin.groups.descriptionLabel')}</Label>
            <Textarea
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('admin.groups.descriptionPlaceholder')}
              maxLength={500}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('admin.groups.permissionsLabel')}</Label>
            {!isAdmin && (
              <p className="text-2xs text-text-faint">{t('admin.groups.permissionsAdminOnly')}</p>
            )}
            <div className="flex flex-col gap-1.5">
              {ADMIN_PERMISSIONS.map((p) => {
                const active = permissions.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => toggle(p)}
                    className={cn(
                      'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'border-accent bg-accent-subtle text-text'
                        : 'border-border text-text-muted hover:border-border-strong',
                      !isAdmin && 'cursor-not-allowed opacity-60',
                    )}
                    aria-pressed={active}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{t(PERMISSION_KEY[p])}</span>
                      <span className="text-2xs text-text-faint">
                        {t(`${PERMISSION_KEY[p]}Desc` as TKey)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'ml-3 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        active ? 'border-accent bg-accent text-white' : 'border-border',
                      )}
                    >
                      {active && <span className="text-[10px] leading-none">✓</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={!canSubmit}>
            {isEdit ? t('common.save') : t('admin.groups.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

/** Members management: current members (with remove) + add via the user directory. */
function GroupMembersDialog({
  group,
  canSearchUsers,
  onOpenChange,
}: {
  group: AdminGroup
  canSearchUsers: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const membersQuery = useQuery(adminGroupMembersOptions(group.id))
  const addMember = useAddMember()
  const removeMember = useRemoveMember()

  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 250)
    return () => clearTimeout(id)
  }, [rawQuery])

  const searchQuery = useQuery({
    ...adminUsersOptions({ query: query || undefined, page: 1, sort: 'lastSeen', dir: 'desc' }),
    enabled: canSearchUsers && query.length > 0,
  })

  const memberIds = useMemo(
    () => new Set((membersQuery.data?.members ?? []).map((m) => m.userId)),
    [membersQuery.data],
  )
  const candidates = (searchQuery.data?.users ?? []).filter((u) => !memberIds.has(u.userId))

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.groups.membersTitle', { name: group.name })}</DialogTitle>
          <DialogDescription>{t('admin.groups.membersHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Current members */}
          <div className="flex flex-col gap-1.5">
            {membersQuery.isPending ? (
              <Skeleton className="h-10 w-full rounded-md" />
            ) : (membersQuery.data?.members.length ?? 0) === 0 ? (
              <p className="text-xs text-text-faint">{t('admin.groups.noMembers')}</p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {membersQuery.data!.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate text-sm text-text">
                      {m.email ?? m.userId}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0 text-text-muted hover:text-danger"
                      aria-label={t('admin.groups.removeMember')}
                      disabled={removeMember.isPending}
                      onClick={() => removeMember.mutate({ groupId: group.id, userId: m.userId })}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add member */}
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <Label htmlFor="member-search">{t('admin.groups.addMember')}</Label>
            {canSearchUsers ? (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
                  <Input
                    id="member-search"
                    value={rawQuery}
                    onChange={(e) => setRawQuery(e.target.value)}
                    placeholder={t('admin.groups.searchPlaceholder')}
                    className="pl-8"
                  />
                </div>
                {query.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                    {searchQuery.isPending ? (
                      <Skeleton className="h-8 w-full rounded-md" />
                    ) : candidates.length === 0 ? (
                      <li className="px-1 py-1 text-2xs text-text-faint">
                        {t('admin.groups.noResults')}
                      </li>
                    ) : (
                      candidates.slice(0, 6).map((u) => (
                        <li key={u.userId}>
                          <button
                            type="button"
                            disabled={addMember.isPending}
                            onClick={() =>
                              addMember.mutate({ groupId: group.id, userId: u.userId })
                            }
                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                          >
                            <UserPlus className="size-3.5 shrink-0" />
                            <span className="truncate">{u.email ?? u.userId}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </>
            ) : (
              <RawIdAdd
                onAdd={(userId) => addMember.mutate({ groupId: group.id, userId })}
                pending={addMember.isPending}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Fallback add-by-id for a delegate without `users.view` (cannot search). */
function RawIdAdd({ onAdd, pending }: { onAdd: (userId: string) => void; pending: boolean }) {
  const t = useT()
  const [value, setValue] = useState('')
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('admin.groups.userIdPlaceholder')}
      />
      <Button
        variant="outline"
        disabled={pending || value.trim().length === 0}
        onClick={() => {
          onAdd(value.trim())
          setValue('')
        }}
      >
        {t('admin.groups.add')}
      </Button>
    </div>
  )
}

function DeleteGroupDialog({
  group,
  onOpenChange,
}: {
  group: AdminGroup | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const del = useDeleteGroup()
  if (!group) return null
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.groups.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('admin.groups.deleteWarning', { name: group.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-danger text-white hover:bg-danger/90"
            onClick={() =>
              del.mutate(
                { id: group.id },
                {
                  onSuccess: () => {
                    toast.success(t('admin.groups.toastDeleted'))
                    onOpenChange(false)
                  },
                },
              )
            }
          >
            {t('admin.groups.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function GroupsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  )
}
