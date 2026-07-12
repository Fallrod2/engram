import { useImperativeHandle, useMemo, type Ref } from 'react'
import { ChevronDown, GraduationCap, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Exam, Subject } from '@engram/shared'
import { localDayKey } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/empty-state'
import { SubjectDot } from '@/components/subject-dot'
import { Countdown } from '@/components/countdown'
import { useRovingList } from '@/lib/use-roving'
import { isEditableTarget } from '@/lib/use-hotkeys'

/** Imperative handle: move focus into the list (grid `e` fallback, spec §2.4). */
export type ExamListHandle = { focus: () => void }

/**
 * Upcoming exams with countdowns (spec §6.2). Source = the single exams cache,
 * split client-side into upcoming (`date >= today`, date asc) and a collapsible
 * "Passés" section. 1D roving list; `Enter`/`e` edit, `⌫`/`x` delete.
 */
export function ExamList({
  exams,
  subjectsById,
  now,
  ref,
  onNew,
  onEdit,
  onDelete,
}: {
  exams: Exam[]
  subjectsById: Map<string, Subject>
  now: Date
  ref?: Ref<ExamListHandle>
  onNew: () => void
  onEdit: (exam: Exam) => void
  onDelete: (exam: Exam) => void
}) {
  const todayKey = localDayKey(now)
  const { upcoming, past } = useMemo(() => {
    const up: Exam[] = []
    const pa: Exam[] = []
    for (const e of exams) {
      if (localDayKey(new Date(e.date)) >= todayKey) up.push(e)
      else pa.push(e)
    }
    up.sort((a, b) => a.date.localeCompare(b.date))
    pa.sort((a, b) => b.date.localeCompare(a.date))
    return { upcoming: up, past: pa }
  }, [exams, todayKey])

  const roving = useRovingList<HTMLDivElement>(upcoming.length, (i) => {
    const e = upcoming[i]
    if (e) onEdit(e)
  })
  const active = upcoming[roving.active]

  // Grid `e` with ≠1 exam on the focused day focuses the list: land on the first
  // upcoming row (no-op when the list holds no upcoming exams to navigate).
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (upcoming.length > 0) roving.focusIndex(0)
      },
    }),
    [upcoming.length, roving],
  )

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="Aucun examen à venir."
        meta="Ajoute une échéance pour piloter tes révisions."
        className="min-h-0 py-8"
        action={
          <Button variant="secondary" onClick={onNew}>
            Nouvel examen
            <Kbd className="ml-1">n</Kbd>
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        onKeyDown={(e) => {
          roving.onKeyDown(e)
          if (isEditableTarget(e.target)) return
          if ((e.key === 'x' || e.key === 'Backspace') && active) {
            e.preventDefault()
            onDelete(active)
          } else if (e.key === 'e' && active) {
            e.preventDefault()
            onEdit(active)
          }
        }}
      >
        {upcoming.map((exam, i) => (
          <ExamRow
            key={exam.id}
            exam={exam}
            subjectsById={subjectsById}
            now={now}
            itemProps={roving.getItemProps(i)}
            onEdit={() => onEdit(exam)}
            onDelete={() => onDelete(exam)}
          />
        ))}
        {upcoming.length === 0 && (
          <p className="px-1 py-4 text-xs text-text-muted">Aucun examen à venir.</p>
        )}
      </div>

      {past.length > 0 && (
        <Collapsible className="mt-1 border-t border-border pt-1">
          <CollapsibleTrigger className="group/col flex w-full items-center gap-1.5 rounded-sm px-1 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint hover:text-text-muted">
            <ChevronDown className="size-3 transition-transform duration-fast group-data-[state=closed]/col:-rotate-90" />
            Passés
            <span className="font-mono tabular-nums">{past.length}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {past.map((exam) => (
              <ExamRow
                key={exam.id}
                exam={exam}
                subjectsById={subjectsById}
                now={now}
                muted
                onEdit={() => onEdit(exam)}
                onDelete={() => onDelete(exam)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function ExamRow({
  exam,
  subjectsById,
  now,
  muted,
  itemProps,
  onEdit,
  onDelete,
}: {
  exam: Exam
  subjectsById: Map<string, Subject>
  now: Date
  muted?: boolean
  itemProps?: ReturnType<ReturnType<typeof useRovingList<HTMLDivElement>>['getItemProps']>
  onEdit: () => void
  onDelete: () => void
}) {
  const subjects = exam.subjectIds
    .map((id) => subjectsById.get(id))
    .filter((s): s is Subject => !!s)
  const dateLabel = new Date(exam.date).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })
  const optimistic = exam.id.startsWith('optimistic:')

  return (
    <div
      {...itemProps}
      className={cn(
        'group/row flex items-center gap-2 rounded-sm px-1 py-1.5 outline-none',
        !muted && 'hover:bg-surface-2',
        optimistic && 'opacity-60',
      )}
    >
      <span className="w-10 shrink-0">
        <Countdown dateIso={exam.date} now={now} />
      </span>
      <span
        className={cn(
          'w-14 shrink-0 font-mono text-xs tabular-nums',
          muted ? 'text-text-faint' : 'text-text-muted',
        )}
      >
        {dateLabel}
      </span>
      <span
        className={cn('min-w-0 flex-1 truncate text-sm', muted ? 'text-text-muted' : 'text-text')}
      >
        {exam.title}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {subjects.slice(0, 3).map((s) => (
          <SubjectDot key={s.id} color={s.color} muted={s.archived} />
        ))}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-text-muted opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100"
            aria-label={`Actions de l'examen ${exam.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Éditer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger [&_svg]:text-danger" onSelect={onDelete}>
            <Trash2 />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
