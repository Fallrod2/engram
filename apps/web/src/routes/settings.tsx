import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowUpRight, Compass } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { SetPasswordForm } from '@/features/auth/set-password-form'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { BackupCard } from '@/features/backup/backup-card'
import { AiSettingsCard } from '@/features/ai/ai-settings-card'
import { MotionRow } from '@/features/settings/motion-row'
import { LanguageSelect, ThemeSelect } from '@/features/settings/appearance-controls'
import { StudyPaceCard } from '@/features/study-settings/study-pace-card'
import { AUTH_ENABLED_WEB } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { appVersionLabel } from '@/lib/build-info'
import { fetchHealth } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const t = useT()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.appearanceTitle')}</CardTitle>
          <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
        </CardHeader>
        {/* Theme and motion in ONE card, not two: both are "how the app looks
            and behaves on this machine", and both default to following the
            system. Splitting them would have made the second card's only job
            to hold a single switch. */}
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="theme-select">{t('settings.theme')}</Label>
            <ThemeSelect id="theme-select" className="w-40" />
          </div>
          <Separator />
          <MotionRow />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.languageTitle')}</CardTitle>
          <CardDescription>{t('settings.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="lang-select">{t('settings.language')}</Label>
          <LanguageSelect id="lang-select" className="w-40" />
        </CardContent>
      </Card>

      {/* Pacing sits ABOVE the AI card and below appearance: it is the only
          setting on this screen that changes what the review session hands the
          user, so it outranks configuration they may never touch. Same component
          as step 2 of the first-run journey. */}
      <StudyPaceCard />

      <AiSettingsCard />

      <BackupCard />

      {AUTH_ENABLED_WEB && <AccountCard />}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.aboutTitle')}</CardTitle>
          <CardDescription>{t('settings.aboutDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-text-muted">
          <div className="flex items-center justify-between gap-4">
            <span>{t('settings.version')}</span>
            <span className="truncate font-mono text-xs tabular-nums text-text">
              {appVersionLabel()}
            </span>
          </div>
          <Separator />
          <ModeRow />
          <Separator />
          {/* Re-entry to the first-run journey (T-049). It lives HERE, next to
              the landing, because both are "open a product surface again" rather
              than a setting — and because the journey is not a setting: it is a
              guided pass over settings that already exist on this screen.
              Reopening never re-arms the marker, so finishing it a second time
              changes nothing but the values the user picks. */}
          <div className="flex items-center justify-between gap-4">
            <span>{t('settings.onboarding')}</span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/onboarding">
                {t('settings.onboardingAction')}
                <Compass />
              </Link>
            </Button>
          </div>
          <Separator />
          {/* The public landing lives at `/welcome` and renders whatever the
              session says — signing in used to bury it for good, since `/` turns
              into the dashboard and nothing linked to it. "À propos" is where a
              user looks for "what is this product", so the way back sits here
              (and in ⌘K). No sign-out round trip involved. */}
          <div className="flex items-center justify-between gap-4">
            <span>{t('settings.landing')}</span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/welcome">
                {t('settings.landingAction')}
                <ArrowUpRight />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * "Mode" row of the About card.
 *
 * It used to be the constant `Localhost · mono-utilisateur`, which stopped being
 * true the day the app shipped to the public web with Supabase auth — a tester
 * called it out as the thing that "sape la confiance en trois secondes". The row
 * now ASKS the server: `GET /api/health` reports `authEnforced`, the very flag
 * the `/api/*` gate resolves per request (`apps/server/src/http/auth.ts`), so the
 * line cannot disagree with the deployment it describes.
 *
 * The two states are the two real ones, and each names both halves of what a
 * reader wants to know:
 *   gate ON  → every request carries a verified JWT and rows are scoped by
 *              `user_id` ⇒ "Authentification activée · multi-utilisateur"
 *   gate OFF → the server assumes one default identity (`ENGRAM_DEV_USER_ID`)
 *              ⇒ "Authentification désactivée · mono-utilisateur", which is
 *              exactly what a developer running the stack locally has.
 *
 * A server that cannot answer gets the shared "unavailable" wording, never a
 * guess: claiming "multi-user" while the probe is down would be the same class
 * of lie this row was fixed for.
 */
function ModeRow() {
  const t = useT()
  const { data, isPending, isError } = useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 60_000,
  })

  return (
    <div className="flex items-center justify-between gap-4">
      <span>{t('settings.mode')}</span>
      {isPending ? (
        <Skeleton className="h-4 w-56" aria-label={t('settings.mode')} />
      ) : (
        <span className="text-right text-text">
          {isError
            ? t('common.unavailable')
            : data.authEnforced
              ? t('settings.modeMultiUser')
              : t('settings.modeSingleUser')}
        </span>
      )}
    </div>
  )
}

/** Session, change-password + sign-out (spec §3.5). Only when web auth is enabled. */
function AccountCard() {
  const t = useT()
  const { email, signOut } = useAuth()
  const [changeOpen, setChangeOpen] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.accountTitle')}</CardTitle>
        <CardDescription>{t('settings.accountDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <span className="truncate font-mono text-xs text-text-muted">{email}</span>
        <div className="flex items-center gap-2">
          <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">{t('settings.changePassword')}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('settings.changePassword')}</DialogTitle>
                <DialogDescription>{t('auth.setPassword.subtitle')}</DialogDescription>
              </DialogHeader>
              <SetPasswordForm
                submitLabel={t('settings.changePassword')}
                onSuccess={() => {
                  setChangeOpen(false)
                  toast.success(t('settings.changePasswordDone'))
                }}
              />
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => void signOut()}>
            {t('settings.signOut')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
