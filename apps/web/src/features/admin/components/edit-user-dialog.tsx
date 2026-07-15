import { useState } from 'react'
import { toast } from 'sonner'
import type { AdminUserSummary } from '@engram/shared'
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
import { useT } from '@/lib/i18n'
import { useUpdateUserEmail } from '../queries'

/**
 * Edit an account's login email (spec §2 / amendment A11). GoTrue is the unicity
 * authority — a clash on another account surfaces as the localized "email taken"
 * toast (mapped in `useUpdateUserEmail`). Password reset stays the user's own
 * forgot-password flow (out of scope, spec §6).
 */
export function EditUserDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const update = useUpdateUserEmail()
  const [email, setEmail] = useState(user?.email ?? '')

  if (!user) return null
  const trimmed = email.trim()
  const emailOk = /.+@.+\..+/.test(trimmed)
  const changed = trimmed !== (user.email ?? '')
  const canSubmit = emailOk && changed && !update.isPending

  function onSubmit() {
    if (!user || !canSubmit) return
    update.mutate(
      { userId: user.userId, email: trimmed },
      {
        onSuccess: () => {
          toast.success(t('admin.editUser.toastUpdated'))
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('admin.editUser.title')}</DialogTitle>
          <DialogDescription>{t('admin.editUser.hint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-email">{t('admin.editUser.emailLabel')}</Label>
          <Input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            autoFocus
            aria-invalid={trimmed.length > 0 && !emailOk}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {t('admin.editUser.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
