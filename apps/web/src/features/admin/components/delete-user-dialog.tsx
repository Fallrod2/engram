import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TriangleAlert } from 'lucide-react'
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
import { useDeleteUser } from '../queries'

/**
 * Reinforced destructive confirmation (spec §4): a GDPR account deletion is
 * irreversible, so the admin must TYPE the account's email (or its id when the
 * email is null) before the confirm button unlocks. On success the toast tells
 * whether the login (auth.users) was also revoked (`authDeleted`).
 */
export function DeleteUserDialog({
  user,
  onOpenChange,
}: {
  user: AdminUserSummary | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const del = useDeleteUser()
  const [typed, setTyped] = useState('')

  // Reset the typed value whenever the target changes (dialog re-opens).
  useEffect(() => {
    setTyped('')
  }, [user?.userId])

  if (!user) return null
  const confirmValue = user.email ?? user.userId
  const matches = typed.trim() === confirmValue

  function onConfirm() {
    if (!user || !matches) return
    del.mutate(user.userId, {
      onSuccess: (res) => {
        const counts = Object.values(res.deletedCounts).reduce((a, b) => a + b, 0)
        toast.success(t('admin.toasts.deleted', { counts }))
        if (!res.authDeleted) toast.warning(t('admin.toasts.authKept'))
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-danger">
            <TriangleAlert className="size-5" />
            {t('admin.delete.title')}
          </DialogTitle>
          <DialogDescription>
            {t('admin.delete.warning', { email: confirmValue })}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning">
          {t('admin.delete.authNote')}
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-delete">
            {t('admin.delete.confirmPrompt', { value: confirmValue })}
          </Label>
          <Input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            aria-invalid={typed.length > 0 && !matches}
            className="font-mono text-sm"
          />
          {typed.length > 0 && !matches && (
            <span className="text-2xs text-danger">{t('admin.delete.mismatch')}</span>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={!matches || del.isPending} onClick={onConfirm}>
            {t('admin.delete.confirmLabel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
