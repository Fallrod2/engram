/**
 * Pause overlay — mechanism B only (tab hidden, spec §8.3.B). Shown on return
 * to a hidden tab until a presence signal. Any key OR click/pointerdown resumes
 * (finding #4) — the keys are handled by the session's global handler; this
 * captures the pointer. Precedence over the exit dialog (§11.4) via a higher
 * z-index. The counter stays frozen behind it.
 */
export function IdleOverlay({ onResume }: { onResume: () => void }) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      onPointerDown={onResume}
      role="status"
    >
      <p className="font-mono text-sm text-text-muted">
        Session en pause — appuie sur une touche ou clique pour reprendre
      </p>
    </div>
  )
}
