import { useTheme, type ThemePreference } from '@/lib/theme'
import { useLang, useT, type LangPreference } from '@/lib/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The theme and language pickers, as ONE implementation each.
 *
 * They are mounted twice — Settings, and step 1 of the first-run journey — and
 * both mounts must obey the same invariant, which is easy to break and invisible
 * when broken: NOTHING IS PERSISTED UNTIL THE USER PICKS. `useTheme` / `useLang`
 * already guarantee it (writing lives in `setTheme` / `setLang`, never in a mount
 * effect — see `lib/theme.tsx`), and keeping a single control means the journey
 * cannot grow a well-meaning "apply the current value on mount" of its own.
 *
 * `'system'` is FIRST in both lists and it is the default: no stored value means
 * the app follows the browser/OS. It also has to stay IN the list, because
 * picking it again is the only way back after an explicit choice.
 */

const THEME_KEYS: Record<
  ThemePreference,
  'settings.themeSystem' | 'settings.themeDark' | 'settings.themeLight'
> = {
  system: 'settings.themeSystem',
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
}

const LANG_KEYS: Record<
  LangPreference,
  'settings.langSystem' | 'settings.langFr' | 'settings.langEn'
> = {
  system: 'settings.langSystem',
  fr: 'settings.langFr',
  en: 'settings.langEn',
}

export function ThemeSelect({ id, className }: { id: string; className?: string }) {
  const { theme, setTheme } = useTheme()
  const t = useT()
  return (
    <Select value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
      <SelectTrigger id={id} className={className}>
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
  )
}

export function LanguageSelect({ id, className }: { id: string; className?: string }) {
  const { preference, setLang } = useLang()
  const t = useT()
  return (
    <Select value={preference} onValueChange={(v) => setLang(v as LangPreference)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={t('settings.language')} />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(LANG_KEYS) as LangPreference[]).map((key) => (
          <SelectItem key={key} value={key}>
            {t(LANG_KEYS[key])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
