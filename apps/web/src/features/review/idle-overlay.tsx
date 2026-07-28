import { useT } from '@/lib/i18n'
import { useTouchSession } from './pointer-labels'

/**
 * Pause overlay — mechanism B only (tab hidden, spec §8.3.B). Shown on return
 * to a hidden tab until a presence signal. Any key OR click/pointerdown resumes
 * (finding #4) — the keys are handled by the session's global handler; this
 * captures the pointer. Precedence over the exit dialog (§11.4) via a higher
 * z-index. The counter stays frozen behind it.
 *
 * T-029 — the sentence follows the pointer. "Appuie sur une touche ou clique"
 * names two gestures a phone cannot make, on the one screen whose entire job is
 * to tell the user how to carry on; the tap it DOES respond to went unmentioned.
 * The overlay itself is unchanged: `onPointerDown` already covers a finger, so
 * this is a wording fix, not a behaviour one.
 */
export function IdleOverlay({ onResume }: { onResume: () => void }) {
  const t = useT()
  const touch = useTouchSession()
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center bg-bg/80 backdrop-blur-sm"
      onPointerDown={onResume}
      role="status"
    >
      <p className="font-mono text-sm text-text-muted">
        {t(touch ? 'session.pausedTouch' : 'session.paused')}
      </p>
    </div>
  )
}
