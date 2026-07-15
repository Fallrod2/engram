import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Mail, KeyRound } from 'lucide-react'
import type { AdminCreateUser, UserRole } from '@engram/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { adminGroupsOptions, meQuery, useCreateUser } from '../queries'

/**
 * Create an account (spec §2 / amendment A12). The UI MIRRORS the server gate
 * (the server stays the sole authority): the `admin` role option is enabled only
 * for a full admin (A2), and the group multi-select shows only when the caller can
 * manage groups (`groups.manage` or admin, A1) — otherwise picking a group would
 * 403 server-side. Two modes: invite by email (default; reuses /set-password) or a
 * temporary password (via the shared `PasswordInput`, min 8).
 */
export function CreateUserDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const create = useCreateUser()
  const me = useQuery(meQuery()).data
  const isAdmin = me?.isAdmin === true
  const canManageGroups = isAdmin || (me?.permissions.includes('groups.manage') ?? false)
  const groupsQuery = useQuery({ ...adminGroupsOptions(), enabled: canManageGroups })
  const groups = groupsQuery.data?.groups ?? []

  const [email, setEmail] = useState('')
  const [mode, setMode] = useState<'invite' | 'password'>('invite')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [groupIds, setGroupIds] = useState<string[]>([])

  const emailOk = /.+@.+\..+/.test(email.trim())
  const passwordOk = mode === 'invite' || password.length >= 8
  const canSubmit = emailOk && passwordOk && !create.isPending

  function toggleGroup(id: string) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function onSubmit() {
    if (!canSubmit) return
    const trimmed = email.trim()
    // Only forward group ids the caller is actually allowed to set.
    const chosen = canManageGroups && groupIds.length > 0 ? groupIds : undefined
    const body: AdminCreateUser =
      mode === 'invite'
        ? { mode: 'invite', email: trimmed, role, ...(chosen ? { groupIds: chosen } : {}) }
        : {
            mode: 'password',
            email: trimmed,
            password,
            role,
            ...(chosen ? { groupIds: chosen } : {}),
          }
    create.mutate(body, {
      onSuccess: () => {
        toast.success(
          mode === 'invite'
            ? t('admin.createUser.toastInvited', { email: trimmed })
            : t('admin.createUser.toastCreated'),
        )
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.createUser.title')}</DialogTitle>
          <DialogDescription>{t('admin.createUser.hint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-email">{t('admin.createUser.emailLabel')}</Label>
            <Input
              id="create-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('admin.createUser.emailPlaceholder')}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Mode */}
          <div className="flex flex-col gap-2">
            <Label>{t('admin.createUser.modeLabel')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <ModeCard
                active={mode === 'invite'}
                icon={<Mail className="size-4" />}
                title={t('admin.createUser.modeInvite')}
                hint={t('admin.createUser.modeInviteHint')}
                onClick={() => setMode('invite')}
              />
              <ModeCard
                active={mode === 'password'}
                icon={<KeyRound className="size-4" />}
                title={t('admin.createUser.modePassword')}
                hint={t('admin.createUser.modePasswordHint')}
                onClick={() => setMode('password')}
              />
            </div>
          </div>

          {mode === 'password' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-password">{t('admin.createUser.passwordLabel')}</Label>
              <PasswordInput
                id="create-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                aria-invalid={password.length > 0 && password.length < 8}
              />
              <span className="text-2xs text-text-faint">{t('admin.createUser.passwordHint')}</span>
            </div>
          )}

          {/* Role */}
          <div className="flex flex-col gap-2">
            <Label>{t('admin.createUser.roleLabel')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <SegButton active={role === 'user'} onClick={() => setRole('user')}>
                {t('admin.users.roleUser')}
              </SegButton>
              <SegButton
                active={role === 'admin'}
                disabled={!isAdmin}
                onClick={() => setRole('admin')}
              >
                {t('admin.users.roleAdmin')}
              </SegButton>
            </div>
            {!isAdmin && (
              <span className="text-2xs text-text-faint">
                {t('admin.createUser.roleAdminOnly')}
              </span>
            )}
          </div>

          {/* Groups (only when the caller can manage groups — mirrors the server A1 gate) */}
          {canManageGroups && (
            <div className="flex flex-col gap-2">
              <Label>{t('admin.createUser.groupsLabel')}</Label>
              <span className="text-2xs text-text-faint">{t('admin.createUser.groupsHint')}</span>
              {groups.length === 0 ? (
                <span className="text-2xs text-text-faint">{t('admin.createUser.groupsNone')}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => {
                    const active = groupIds.includes(g.id)
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => toggleGroup(g.id)}
                        aria-pressed={active}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs transition-colors',
                          active
                            ? 'border-accent bg-accent-subtle text-text'
                            : 'border-border text-text-muted hover:border-border-strong',
                        )}
                      >
                        {g.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {mode === 'invite'
              ? t('admin.createUser.submitInvite')
              : t('admin.createUser.submitPassword')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({
  active,
  icon,
  title,
  hint,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors',
        active ? 'border-accent bg-accent-subtle' : 'border-border hover:border-border-strong',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-text">
        {icon}
        {title}
      </span>
      <span className="text-2xs text-text-faint">{hint}</span>
    </button>
  )
}

function SegButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-2 text-sm transition-colors',
        active
          ? 'border-accent bg-accent-subtle text-text'
          : 'border-border text-text-muted hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {children}
    </button>
  )
}
