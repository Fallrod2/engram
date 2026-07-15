import { createFileRoute } from '@tanstack/react-router'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'

/**
 * Dedicated "account suspended" screen (spec §2.1, amendment A3). The api client
 * routes here on the first 403 `suspended` instead of letting every query fail
 * silently. Rendered BARE (outside the app shell, like `/login`) so it fires no
 * data query that would 403 again — it only offers a clear explanation + sign-out.
 */
export const Route = createFileRoute('/suspended')({
  component: SuspendedPage,
})

function SuspendedPage() {
  const t = useT()
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-border bg-surface-1 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
          <Ban className="size-6" />
        </span>
        <h1 className="text-lg font-semibold text-text">{t('admin.suspended.title')}</h1>
        <p className="text-sm text-text-muted">{t('admin.suspended.body')}</p>
        <Button variant="outline" onClick={() => void signOut()}>
          {t('admin.suspended.signOut')}
        </Button>
      </div>
    </div>
  )
}
