import { Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useT, type TKey } from '@/lib/i18n'
import {
  setMotionPreference,
  useMotionPreference,
  useSystemPrefersReducedMotion,
} from '@/lib/motion'

/**
 * "Always animate" — the in-app override of `prefers-reduced-motion` (29/07/2026).
 *
 * A switch and not a three-valued control: the OS already owns "reduce motion",
 * and this only answers the one question it cannot — "yes, I know, animate
 * anyway". Off is therefore not "no animations", it is "follow my system", which
 * is what the notice under it spells out rather than leaving to be inferred from
 * a switch position.
 *
 * THE NOTICE IS THE HONEST PART, and it is why this row is not just a switch.
 * Three states, three sentences, and none of them can be read off the control:
 *
 *   system asks for less + no override → the app HAS reduced its motion, and the
 *     switch is how to get it back. Without this line the user sees a dead app
 *     and no reason for it — the case the old reveal setting already had to
 *     explain.
 *   system asks for less + override on → the app is animating AGAINST a
 *     system preference. Saying so is what makes the override deliberate rather
 *     than silent; that distinction is the whole reason it is allowed at all.
 *   system asks for nothing → the switch changes nothing today. Better said out
 *     loud than discovered by flipping it and watching nothing happen.
 */
export function MotionRow() {
  const t = useT()
  const preference = useMotionPreference()
  const systemReduced = useSystemPrefersReducedMotion()
  const forced = preference === 'full'

  const notice: TKey = !systemReduced
    ? 'settings.motion.noticeSystemNeutral'
    : forced
      ? 'settings.motion.noticeOverridden'
      : 'settings.motion.noticeReduced'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="motion-switch">{t('settings.motion.label')}</Label>
          <span className="text-xs text-text-faint">{t('settings.motion.desc')}</span>
        </div>
        <Switch
          id="motion-switch"
          checked={forced}
          onCheckedChange={(next) => setMotionPreference(next ? 'full' : 'system')}
        />
      </div>
      <p className="flex items-start gap-2 text-xs text-text-muted">
        <Info aria-hidden className="mt-px size-3.5 shrink-0 text-text-faint" />
        <span>{t(notice)}</span>
      </p>
    </div>
  )
}
