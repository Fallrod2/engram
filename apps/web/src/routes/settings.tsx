import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { useLang, useT, type Lang } from '@/lib/i18n'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { BackupCard } from '@/features/backup/backup-card'
import { AiSettingsCard } from '@/features/ai/ai-settings-card'
import { AUTH_ENABLED_WEB } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

const THEME_KEYS: Record<
  ThemePreference,
  'settings.themeSystem' | 'settings.themeDark' | 'settings.themeLight'
> = {
  system: 'settings.themeSystem',
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
}

const LANG_KEYS: Record<Lang, 'settings.langFr' | 'settings.langEn'> = {
  fr: 'settings.langFr',
  en: 'settings.langEn',
}

function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { lang, setLang } = useLang()
  const t = useT()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.appearanceTitle')}</CardTitle>
          <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="theme-select">{t('settings.theme')}</Label>
          <Select value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
            <SelectTrigger id="theme-select" className="w-40">
              <SelectValue placeholder={t('settings.theme')} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(THEME_KEYS) as ThemePreference[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {t(THEME_KEYS[key])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.languageTitle')}</CardTitle>
          <CardDescription>{t('settings.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="lang-select">{t('settings.language')}</Label>
          <Select value={lang} onValueChange={(v) => setLang(v as Lang)}>
            <SelectTrigger id="lang-select" className="w-40">
              <SelectValue placeholder={t('settings.language')} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LANG_KEYS) as Lang[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {t(LANG_KEYS[key])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <AiSettingsCard />

      <BackupCard />

      {AUTH_ENABLED_WEB && <AccountCard />}

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.aboutTitle')}</CardTitle>
          <CardDescription>{t('settings.aboutDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-text-muted">
          <div className="flex items-center justify-between">
            <span>{t('settings.version')}</span>
            <span className="font-mono text-xs tabular-nums text-text">0.0.0</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span>{t('settings.mode')}</span>
            <span className="text-text">{t('settings.modeValue')}</span>
          </div>
        </CardContent>
      </Card>
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
