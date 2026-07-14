import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { Subject } from '@engram/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/empty-state'
import { useT, usePlural } from '@/lib/i18n'
import { ErrorState } from '@/components/error-state'
import { SubjectsIllustration } from '@/components/illustrations'
import { SubjectsSkeleton } from '@/components/skeletons'
import { EntityRow, RowActions, entityRowClass } from '@/components/entity-row'
import { SubjectDot } from '@/components/subject-dot'
import { SubjectIcon } from '@/components/subject-icon'
import { CountStat } from '@/components/count-stat'
import { DueCount } from '@/components/due-count'
import { ConfirmDelete } from '@/components/confirm-delete'
import { cn } from '@/lib/utils'
import { useHotkeys } from '@/lib/use-hotkeys'
import { useRovingList } from '@/lib/use-roving'
import { useCoarsePointer } from '@/lib/use-media-query'
import {
  subjectsListOptions,
  useCreateSubject,
  useUpdateSubject,
  useArchiveSubject,
  useDeleteSubject,
} from '@/features/subjects/queries'
import { allDecksOptions, deckCardCountsOptions } from '@/features/decks/queries'
import { dueCountsOptions, bySubjectMap } from '@/features/due-counts/queries'
import { SubjectFormDialog } from '@/features/subjects/subject-form-dialog'

export const Route = createFileRoute('/subjects/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(subjectsListOptions()),
  component: SubjectsPage,
  pendingComponent: () => <SubjectsSkeleton />,
  errorComponent: SubjectsError,
})

function SubjectsError() {
  const router = useRouter()
  return <ErrorState kind="subjects" onRetry={() => void router.invalidate()} />
}

type Tab = 'active' | 'archived'

function SubjectsPage() {
  const t = useT()
  const plural = usePlural()
  const subjects = useQuery(subjectsListOptions()).data ?? []
  const allDecks = useQuery(allDecksOptions()).data
  const dueCounts = useQuery(dueCountsOptions()).data

  const [tab, setTab] = useState<Tab>('active')
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editSubject, setEditSubject] = useState<Subject | null>(null)
  const [deleteSubject, setDeleteSubject] = useState<Subject | null>(null)

  const createMut = useCreateSubject()
  const updateMut = useUpdateSubject()
  const archiveMut = useArchiveSubject()
  const deleteMut = useDeleteSubject()
  const coarse = useCoarsePointer()

  const deckCountBySubject = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of allDecks ?? []) m.set(d.subjectId, (m.get(d.subjectId) ?? 0) + 1)
    return m
  }, [allDecks])

  // Aggregate a card total per subject (spec §2 CARTES column) from ONE
  // `GET /decks/card-counts` request (Phase 7 §2.2) instead of a per-deck probe
  // fan-out. A subject's total is `undefined` (→ skeleton) until both the deck
  // list and the aggregate counts have loaded.
  const cardCounts = useQuery(deckCardCountsOptions()).data
  const cardTotalBySubject = useMemo(() => {
    const m = new Map<string, number | undefined>()
    if (allDecks === undefined || cardCounts === undefined) {
      for (const s of subjects) m.set(s.id, undefined)
      return m
    }
    for (const s of subjects) m.set(s.id, 0)
    for (const d of allDecks) {
      m.set(d.subjectId, (m.get(d.subjectId) ?? 0) + (cardCounts.get(d.id) ?? 0))
    }
    return m
  }, [subjects, allDecks, cardCounts])

  const dueMap = useMemo(() => bySubjectMap(dueCounts), [dueCounts])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return subjects
      .filter((s) => (tab === 'archived' ? s.archived : !s.archived))
      .filter((s) => q === '' || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  }, [subjects, tab, filter])

  const roving = useRovingList<HTMLAnchorElement>(visible.length)
  const activeSubject = visible[roving.active]

  function archive(s: Subject) {
    archiveMut.mutate(
      { id: s.id, archived: !s.archived },
      {
        onSuccess: () => {
          toast(t('subjects.archivedToast'), {
            action: !s.archived
              ? {
                  label: t('common.undo'),
                  onClick: () => archiveMut.mutate({ id: s.id, archived: false }),
                }
              : undefined,
          })
        },
      },
    )
  }

  useHotkeys({
    // preventDefault stops the trigger key from leaking into the input that a
    // dialog/composer autofocuses on open.
    n: (e) => {
      e.preventDefault()
      setCreateOpen(true)
    },
    '/': (e) => {
      e.preventDefault()
      document.getElementById('subjects-filter')?.focus()
    },
    e: (e) => {
      e.preventDefault()
      if (activeSubject) setEditSubject(activeSubject)
    },
    a: (e) => {
      e.preventDefault()
      if (activeSubject) archive(activeSubject)
    },
    x: (e) => {
      e.preventDefault()
      if (activeSubject) setDeleteSubject(activeSubject)
    },
    backspace: (e) => {
      // Stop the browser's back-navigation on Backspace.
      e.preventDefault()
      if (activeSubject) setDeleteSubject(activeSubject)
    },
  })

  return (
    <div>
      {/* Toolbar (the shell header already names the section "Matières"). Wraps
          below sm: filter full-width on line 1, tabs + CTA on line 2, so the row
          never forces horizontal page pan (fix-mobile-shell §toolbar). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
          <Input
            id="subjects-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                if (filter) setFilter('')
                else e.currentTarget.blur()
              }
            }}
            placeholder={t('cmd.filterPlaceholder')}
            className="w-full pl-8 sm:w-64"
            aria-label={t('subjects.filterAria')}
          />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="active">{t('subjects.tabActive')}</TabsTrigger>
            <TabsTrigger value="archived">{t('subjects.tabArchived')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus />
          {t('subjects.new')}
          {!coarse && (
            <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
          )}
        </Button>
      </div>

      <SubjectsBody
        subjects={subjects}
        visible={visible}
        tab={tab}
        filter={filter}
        roving={roving}
        deckCountBySubject={deckCountBySubject}
        deckCountsReady={allDecks !== undefined}
        cardTotalBySubject={cardTotalBySubject}
        dueMap={dueMap}
        onNew={() => setCreateOpen(true)}
        onEdit={setEditSubject}
        onArchive={archive}
        onDelete={setDeleteSubject}
        onClearFilter={() => setFilter('')}
      />

      <SubjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(values) => createMut.mutate(values)}
      />
      <SubjectFormDialog
        open={editSubject !== null}
        onOpenChange={(o) => !o && setEditSubject(null)}
        {...(editSubject ? { subject: editSubject } : {})}
        onSubmit={(values) => {
          if (editSubject) updateMut.mutate({ id: editSubject.id, patch: values })
        }}
      />
      <ConfirmDelete
        open={deleteSubject !== null}
        onOpenChange={(o) => !o && setDeleteSubject(null)}
        title={t('subjects.deleteTitle', { name: deleteSubject?.name ?? '' })}
        description={
          <>
            {t('subjects.deleteLead')}{' '}
            <strong className="text-text">
              {t(`listMeta.decks_${plural(deckCountBySubject.get(deleteSubject?.id ?? '') ?? 0)}`, {
                count: deckCountBySubject.get(deleteSubject?.id ?? '') ?? 0,
              })}
            </strong>
            {t('subjects.deleteTail')}
          </>
        }
        onConfirm={() => deleteSubject && deleteMut.mutate({ id: deleteSubject.id })}
      />
    </div>
  )
}

function SubjectsBody({
  subjects,
  visible,
  tab,
  filter,
  roving,
  deckCountBySubject,
  deckCountsReady,
  cardTotalBySubject,
  dueMap,
  onNew,
  onEdit,
  onArchive,
  onDelete,
  onClearFilter,
}: {
  subjects: Subject[]
  visible: Subject[]
  tab: Tab
  filter: string
  roving: ReturnType<typeof useRovingList<HTMLAnchorElement>>
  deckCountBySubject: Map<string, number>
  deckCountsReady: boolean
  cardTotalBySubject: Map<string, number | undefined>
  dueMap: Map<string, number>
  onNew: () => void
  onEdit: (s: Subject) => void
  onArchive: (s: Subject) => void
  onDelete: (s: Subject) => void
  onClearFilter: () => void
}) {
  const t = useT()
  const coarse = useCoarsePointer()
  const plural = usePlural()
  if (subjects.filter((s) => !s.archived).length === 0 && tab === 'active' && filter === '') {
    return (
      <EmptyState
        illustration={<SubjectsIllustration />}
        title={t('empty.subjectsTitle')}
        meta={t('empty.subjectsMeta')}
        action={
          <Button onClick={onNew}>
            <Plus />
            {t('subjects.new')}
            {!coarse && (
              <Kbd className="ml-1 border-accent-fg/30 bg-transparent text-accent-fg">n</Kbd>
            )}
          </Button>
        }
      />
    )
  }

  if (visible.length === 0) {
    if (filter !== '') {
      return (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">{t('subjects.noMatch', { filter })}</p>
          <Button variant="ghost" size="sm" onClick={onClearFilter}>
            {t('subjects.clearFilter')}
          </Button>
        </div>
      )
    }
    return (
      <p className="py-16 text-center text-sm text-text-muted">
        {tab === 'archived' ? t('subjects.noneArchived') : t('subjects.none')}
      </p>
    )
  }

  return (
    <div>
      {/* List header labels — hidden below sm, where rows use a stacked layout. */}
      <div className="hidden grid-cols-[1fr_64px_72px_88px_40px] items-center px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint sm:grid">
        <span>{t('subjects.colName')}</span>
        <span className="text-right">{t('subjects.colDecks')}</span>
        <span className="text-right">{t('subjects.colCards')}</span>
        <span className="text-right">{t('subjects.colDue')}</span>
        <span />
      </div>

      <ul className="flex flex-col" onKeyDown={roving.onKeyDown}>
        {visible.map((s, i) => {
          const deckCount = deckCountsReady ? (deckCountBySubject.get(s.id) ?? 0) : undefined
          const cardTotal = cardTotalBySubject.get(s.id)
          const due = dueMap.get(s.id) ?? 0
          return (
            <EntityRow key={s.id}>
              <Link
                {...roving.getItemProps(i)}
                to="/subjects/$subjectId"
                params={{ subjectId: s.id }}
                className={entityRowClass(
                  // Stacked on phones (name full-width + meta sub-line), the dense
                  // grid returns at sm (fix-mobile-shell §lists).
                  'flex flex-col items-stretch justify-center gap-0.5 py-1.5 sm:grid sm:grid-cols-[1fr_64px_72px_88px_40px] sm:items-center sm:gap-0 sm:py-0',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SubjectDot color={s.color} muted={s.archived} />
                  <SubjectIcon
                    name={s.icon}
                    className={cn('shrink-0 text-text-muted', s.archived && 'opacity-60')}
                  />
                  <span className={cn('truncate', s.archived ? 'text-text-faint' : 'text-text')}>
                    {s.name}
                  </span>
                </span>
                {/* Mobile-only meta sub-line. */}
                <span className="flex items-center gap-1.5 pl-[1.625rem] font-mono text-2xs tabular-nums text-text-muted sm:hidden">
                  <span>
                    {t(`listMeta.decks_${plural(deckCount ?? 0)}`, { count: deckCount ?? 0 })}
                  </span>
                  <span className="text-border-strong">·</span>
                  <span>
                    {t(`listMeta.cards_${plural(cardTotal ?? 0)}`, { count: cardTotal ?? 0 })}
                  </span>
                  <span className="text-border-strong">·</span>
                  <span>{t(`listMeta.due_${plural(due)}`, { count: due })}</span>
                </span>
                <CountStat value={deckCount} className="hidden justify-self-end sm:block" />
                <CountStat value={cardTotal} className="hidden justify-self-end sm:block" />
                <DueCount
                  value={due}
                  colorHex={s.color}
                  className="hidden justify-self-end sm:inline-flex"
                />
                <span className="hidden sm:block" />
              </Link>
              <RowActions>
                <SubjectRowMenu
                  subject={s}
                  onEdit={onEdit}
                  onArchive={onArchive}
                  onDelete={onDelete}
                />
              </RowActions>
            </EntityRow>
          )
        })}
      </ul>
    </div>
  )
}

function SubjectRowMenu({
  subject,
  onEdit,
  onArchive,
  onDelete,
}: {
  subject: Subject
  onEdit: (s: Subject) => void
  onArchive: (s: Subject) => void
  onDelete: (s: Subject) => void
}) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 pointer-coarse:size-11 text-text-muted"
          aria-label={t('subjects.rowActions', { name: subject.name })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(subject)}>
          <Pencil />
          {t('common.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onArchive(subject)}>
          {subject.archived ? <ArchiveRestore /> : <Archive />}
          {subject.archived ? t('subjects.unarchive') : t('common.archive')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger [&_svg]:text-danger"
          onSelect={() => onDelete(subject)}
        >
          <Trash2 />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
