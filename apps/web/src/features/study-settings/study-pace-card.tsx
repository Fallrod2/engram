import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StudyPaceFields } from './study-pace-fields'

/**
 * Settings → « Rythme de révision ». Card chrome ONLY: the controls, the copy
 * and every write live in `StudyPaceFields`, which step 2 of the first-run
 * journey mounts bare. Nothing here may grow a second opinion about the numbers.
 */
export function StudyPaceCard() {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.pace.title')}</CardTitle>
        <CardDescription>{t('settings.pace.desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <StudyPaceFields />
      </CardContent>
    </Card>
  )
}
