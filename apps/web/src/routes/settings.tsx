import { createFileRoute } from '@tanstack/react-router'
import { useTheme, type ThemePreference } from '@/lib/theme'
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

const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Système',
  dark: 'Sombre',
  light: 'Clair',
}

function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Apparence</CardTitle>
          <CardDescription>Thème de l'interface. « Système » suit ton OS.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <Label htmlFor="theme-select">Thème</Label>
          <Select value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
            <SelectTrigger id="theme-select" className="w-40">
              <SelectValue placeholder="Thème" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(THEME_LABELS) as ThemePreference[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {THEME_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>À propos</CardTitle>
          <CardDescription>Dashboard de révision self-hosted (FSRS).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-text-muted">
          <div className="flex items-center justify-between">
            <span>Version</span>
            <span className="font-mono text-xs tabular-nums text-text">0.0.0</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span>Mode</span>
            <span className="text-text">Localhost · mono-utilisateur</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
