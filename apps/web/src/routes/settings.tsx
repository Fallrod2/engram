import { createFileRoute } from '@tanstack/react-router'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { useLang, useT, type Lang } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

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
