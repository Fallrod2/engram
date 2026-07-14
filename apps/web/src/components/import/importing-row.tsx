import { FileText, Slash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

/** A local, non-persisted upload row (spec §2.3): "importing…" or "error". */
export function ImportingRow({
  filename,
  status,
  error,
  onRetry,
  onRemove,
}: {
  filename: string
  status: 'importing' | 'error'
  error?: string
  onRetry: () => void
  onRemove: () => void
}) {
  const t = useT()
  const failed = status === 'error'
  return (
    <div className="flex h-11 items-center gap-3 rounded-sm pl-3 pr-2">
      {failed ? (
        <Slash className="size-4 shrink-0 text-text-faint" strokeWidth={2} aria-hidden />
      ) : (
        <FileText
          className="size-4 shrink-0 animate-pulse text-text-faint motion-reduce:animate-none"
          aria-hidden
        />
      )}
      <span
        className={cn(
          'truncate text-sm',
          failed ? 'text-text-faint line-through' : 'text-text-muted',
        )}
      >
        {filename}
      </span>
      {failed ? (
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-xs text-text-faint">
            {error ?? t('import.fileIllegible')}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-text-muted" onClick={onRetry}>
            {t('common.retry')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-text-faint" onClick={onRemove}>
            {t('import.remove')}
          </Button>
        </span>
      ) : (
        <span className="ml-auto animate-pulse font-mono text-xs text-text-faint motion-reduce:animate-none">
          {t('import.extracting')}
        </span>
      )}
    </div>
  )
}
