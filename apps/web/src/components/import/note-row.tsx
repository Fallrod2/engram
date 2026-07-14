import { Link } from '@tanstack/react-router'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Note } from '@engram/shared'
import { useT, usePlural } from '@/lib/i18n'
import { isEn, formatDayMonth } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EntityRow, RowActions, entityRowClass } from '@/components/entity-row'

/** Relative import date, e.g. `auj.`, `hier`, `il y a 3j`, or a short date. */
function formatImportedAt(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  if (days <= 0) return isEn() ? 'today' : 'auj.'
  if (days === 1) return isEn() ? 'yesterday' : 'hier'
  if (days < 7) return isEn() ? `${days}d ago` : `il y a ${days}j`
  return formatDayMonth(iso)
}

/** Dense note row (spec §1.10): type badge + title + mono meta, kebab on hover. */
export function NoteRow({
  note,
  generationCount,
  rowProps,
  onEdit,
  onDelete,
}: {
  note: Note
  generationCount: number
  /** Roving-tabindex props from the list's `useRovingList`. */
  rowProps: React.HTMLAttributes<HTMLAnchorElement> & { tabIndex: number }
  onEdit: (note: Note) => void
  onDelete: (note: Note) => void
}) {
  const t = useT()
  const plural = usePlural()
  return (
    <EntityRow>
      <Link
        {...rowProps}
        to="/import/$noteId"
        params={{ noteId: note.id }}
        className={entityRowClass('pr-10')}
      >
        <span className="inline-flex h-4 min-w-8 items-center justify-center rounded-xs bg-surface-3 px-1 font-mono text-2xs uppercase text-text-muted">
          {note.sourceType}
        </span>
        <span className="truncate font-medium text-text">{note.title}</span>
        <span className="ml-auto whitespace-nowrap font-mono text-xs tabular-nums text-text-faint">
          {t(`import.generationCount_${plural(generationCount)}`, { count: generationCount })}
          <span className="px-1 text-border-strong">·</span>
          {formatImportedAt(note.createdAt)}
        </span>
      </Link>
      <RowActions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-text-muted"
              aria-label={t('subjects.rowActions', { name: note.title })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(note)}>
              <Pencil />
              {t('import.noteRename')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-danger [&_svg]:text-danger"
              onSelect={() => onDelete(note)}
            >
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </RowActions>
    </EntityRow>
  )
}
