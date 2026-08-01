import { Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

/**
 * T-066 — the planning screen when its subject list did not answer.
 *
 * Nothing here can be blanked out and nothing should be: the calendar, the day
 * detail and the exam list are all driven by their OWN reads, which may be
 * perfectly healthy. What the subject list feeds is naming — `subjectsById` is
 * consulted for a colour and a label, and `?? '#7999f5'` / `subjectFallback`
 * cover a missing entry silently. So a dropped `GET /api/subjects` degrades the
 * whole screen at once, quietly: every composition row reads "Matière", every
 * exam loses its subject dots, and nothing says why.
 *
 * Hence a NOTICE rather than a panel error: one line above the grid, covering
 * both the grid and the rail, saying what is missing and offering to ask again.
 * Blanking a working calendar because the names went missing would trade a
 * small lie for a large one.
 */
export function SubjectsUnavailableNotice({ onRetry }: { onRetry: () => void }) {
  const t = useT()
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
    >
      <Unplug className="size-3.5 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-text-muted">{t('planning.subjectsError')}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
