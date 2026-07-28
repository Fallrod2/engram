import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { useTouchSession } from './pointer-labels'

/**
 * Exit confirmation (spec §3.6, §4.6). Rendered inside the session overlay (not
 * a separate portal) so the pause overlay can always stack above it (precedence
 * §11.4). Keys are routed by the session's global handler (Échap/Entrée =
 * Reprendre, Q = Quitter); both shortcuts are shown in `<Kbd>` so Q is
 * discoverable (finding #3). Progress is already persisted — this only guards a
 * stray keystroke mid-flow.
 */
export function ExitConfirm({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  // No keyboard on touch → drop the Échap/Q chips (fix-session §3) and grow the
  // two buttons from 32px to a 44px thumb target (T-029): with no key to press,
  // a tap is the ONLY way out of this dialog.
  const touch = useTouchSession()
  const t = useT()
  const tap = cn(touch && 'h-11 px-4')
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exit-confirm-title"
      aria-describedby="exit-confirm-desc"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-3 p-6 shadow-lg">
        <h2 id="exit-confirm-title" className="text-lg font-semibold tracking-[-0.01em] text-text">
          {t('session.exitTitle')}
        </h2>
        <p id="exit-confirm-desc" className="mt-1.5 text-sm text-text-muted">
          {t('session.exitDesc')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button autoFocus variant="secondary" onClick={onResume} className={tap}>
            {t('session.exitResume')}
            {!touch && <Kbd className="ml-1">{t('session.keyEsc')}</Kbd>}
          </Button>
          <Button variant="destructive" onClick={onQuit} className={tap}>
            {t('session.exitQuit')}
            {!touch && (
              <Kbd className="ml-1 border-danger-fg/30 bg-transparent text-danger-fg">Q</Kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
