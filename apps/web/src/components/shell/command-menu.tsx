import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  ChartColumn,
  GraduationCap,
  Keyboard,
  Layers,
  LayoutDashboard,
  Moon,
  Settings,
  SquarePen,
  SquareStack,
  Sun,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useT, type TKey } from '@/lib/i18n'
import { navChordFor } from '@/lib/keymap'
import { subjectsListOptions } from '@/features/subjects/queries'
import { allDecksOptions } from '@/features/decks/queries'
import { dueCountsOptions, bySubjectMap } from '@/features/due-counts/queries'
import { SubjectDot } from '@/components/subject-dot'
import { useShell } from './shell-context'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'

/** A palette sub-page for the multi-step create flows (spec §2.5). */
type Page = 'root' | 'deck:subject' | 'card:subject' | 'card:deck'

interface NavAction {
  /** i18n key for the label; keywords stay bilingual for fuzzy match. */
  label: TKey
  to: string
  icon: LucideIcon
  keywords: string
}

/** Navigation actions (spec §2.3.1). Shortcuts come from `keymap.ts` (in sync). */
const NAV_ACTIONS: NavAction[] = [
  {
    label: 'nav.items.today',
    to: '/',
    icon: LayoutDashboard,
    keywords: 'dashboard accueil home today',
  },
  {
    label: 'nav.items.session',
    to: '/review',
    icon: GraduationCap,
    keywords: 'review réviser session study',
  },
  {
    label: 'pageTitle.subjects',
    to: '/subjects',
    icon: Layers,
    keywords: 'subjects matieres decks cartes',
  },
  {
    label: 'nav.items.planning',
    to: '/planning',
    icon: CalendarDays,
    keywords: 'planning calendrier calendar examens',
  },
  {
    label: 'nav.items.analytics',
    to: '/analytics',
    icon: ChartColumn,
    keywords: 'analytics stats statistiques progression',
  },
  {
    label: 'nav.items.import',
    to: '/import',
    icon: Upload,
    keywords: 'import upload notes pdf markdown',
  },
  {
    label: 'pageTitle.settings',
    to: '/settings',
    icon: Settings,
    keywords: 'settings reglages preferences options',
  },
]

/**
 * ⌘K command palette (spec §2). Actions, not just navigation: quick-create,
 * scoped review sessions, import, theme, help. Groups are stable-ordered; cmdk
 * does the intra-group fuzzy scoring. Dynamic data (subjects, decks, dues) is
 * read from cache — the palette renders what it has and fills in when it lands.
 */
export function CommandMenu() {
  const { commandOpen, setCommandOpen, openCreate, setShortcutsOpen } = useShell()
  const navigate = useNavigate()
  const { resolved, toggle } = useTheme()
  const t = useT()

  const [page, setPage] = useState<Page>('root')
  const [search, setSearch] = useState('')
  const [cardSubjectId, setCardSubjectId] = useState<string | null>(null)

  const subjects = (useQuery(subjectsListOptions()).data ?? []).filter((s) => !s.archived)
  const decks = useQuery(allDecksOptions()).data ?? []
  const dueCounts = useQuery(dueCountsOptions()).data
  const dueBySubject = bySubjectMap(dueCounts)

  const close = () => setCommandOpen(false)
  const resetPage = () => {
    setPage('root')
    setSearch('')
    setCardSubjectId(null)
  }

  const go = (to: string) => {
    close()
    void navigate({ to })
  }

  const reviewSubject = (subjectId: string) => {
    close()
    void navigate({ to: '/review', search: { subjectId } })
  }

  const goBack = () => {
    setSearch('')
    if (page === 'card:deck') setPage('card:subject')
    else setPage('root')
  }

  const onOpenChange = (open: boolean) => {
    setCommandOpen(open)
    if (!open) resetPage()
  }

  // Backspace on an empty input steps back a sub-page (cmdk pattern §2.5).
  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && search === '' && page !== 'root') {
      e.preventDefault()
      goBack()
    }
  }

  const totalDue = dueCounts?.total ?? 0
  const dueSubjects = subjects
    .map((s) => ({ subject: s, due: dueBySubject.get(s.id) ?? 0 }))
    .filter(({ due }) => due > 0)
  const cardDecks = cardSubjectId ? decks.filter((d) => d.subjectId === cardSubjectId) : []

  const stepHint =
    page === 'deck:subject'
      ? t('cmd.step.deckSubject')
      : page === 'card:subject'
        ? t('cmd.step.cardSubject')
        : page === 'card:deck'
          ? t('cmd.step.cardDeck')
          : null

  return (
    <CommandDialog open={commandOpen} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={page === 'root' ? t('cmd.placeholder') : t('cmd.filterPlaceholder')}
        value={search}
        onValueChange={setSearch}
        onKeyDown={onInputKeyDown}
      />
      {stepHint && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-2xs text-text-faint">
          <span>{stepHint}</span>
          <span aria-hidden>·</span>
          <span>{t('cmd.back')}</span>
        </div>
      )}
      <CommandList>
        <CommandEmpty>{t('cmd.empty')}</CommandEmpty>

        {page === 'root' && (
          <>
            <CommandGroup heading={t('cmd.groups.navigation')}>
              {NAV_ACTIONS.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${t(item.label)} ${item.keywords}`}
                  onSelect={() => go(item.to)}
                >
                  <item.icon />
                  {t(item.label)}
                  {navChordFor(item.to) && (
                    <CommandShortcut>{navChordFor(item.to)}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading={t('cmd.groups.create')}>
              <CommandItem
                value={`${t('cmd.actions.newSubject')} créer ajouter subject new add`}
                onSelect={() => {
                  close()
                  openCreate('subject')
                }}
              >
                <Layers />
                {t('cmd.actions.newSubject')}
              </CommandItem>
              <CommandItem
                value={`${t('cmd.actions.newDeck')} créer ajouter deck new add`}
                onSelect={() => {
                  setSearch('')
                  setPage('deck:subject')
                }}
              >
                <SquareStack />
                {t('cmd.actions.newDeck')}
              </CommandItem>
              <CommandItem
                value={`${t('cmd.actions.newCard')} créer ajouter card flashcard new add`}
                onSelect={() => {
                  setSearch('')
                  setPage('card:subject')
                }}
              >
                <SquarePen />
                {t('cmd.actions.newCard')}
              </CommandItem>
              <CommandItem
                value={`${t('cmd.actions.newExam')} créer ajouter exam new add`}
                onSelect={() => {
                  close()
                  openCreate('exam')
                }}
              >
                <GraduationCap />
                {t('cmd.actions.newExam')}
              </CommandItem>
              <CommandItem
                value={`${t('cmd.actions.importNotes')} upload import pdf markdown`}
                onSelect={() => go('/import')}
              >
                <Upload />
                {t('cmd.actions.importNotes')}
              </CommandItem>
            </CommandGroup>

            {totalDue > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('cmd.groups.review')}>
                  <CommandItem
                    value={`${t('cmd.actions.reviewAll')} review all`}
                    onSelect={() => go('/review')}
                  >
                    <GraduationCap />
                    {t('cmd.actions.reviewAll')}
                    <CommandShortcut>{totalDue}</CommandShortcut>
                  </CommandItem>
                  {dueSubjects.map(({ subject, due }) => (
                    <CommandItem
                      key={subject.id}
                      value={`${t('cmd.actions.reviewSubject', { name: subject.name })} review`}
                      onSelect={() => reviewSubject(subject.id)}
                    >
                      <SubjectDot color={subject.color} />
                      {t('cmd.actions.reviewSubject', { name: subject.name })}
                      <CommandShortcut>{due}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading={t('cmd.groups.preferences')}>
              <CommandItem
                value={`${t('cmd.actions.toggleTheme')} theme clair sombre dark light`}
                onSelect={() => {
                  toggle()
                  close()
                }}
              >
                {resolved === 'dark' ? <Sun /> : <Moon />}
                {t('cmd.actions.toggleTheme')}
                <CommandShortcut>
                  {resolved === 'dark' ? t('cmd.themeLight') : t('cmd.themeDark')}
                </CommandShortcut>
              </CommandItem>
              <CommandItem
                value={`${t('cmd.actions.showShortcuts')} keyboard shortcuts aide help`}
                onSelect={() => {
                  close()
                  setShortcutsOpen(true)
                }}
              >
                <Keyboard />
                {t('cmd.actions.showShortcuts')}
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {(page === 'deck:subject' || page === 'card:subject') && (
          <CommandGroup heading={t('cmd.groups.subjects')}>
            {subjects.length === 0 && (
              <CommandItem value="aucune matière" disabled>
                {t('cmd.noSubjects')}
              </CommandItem>
            )}
            {subjects.map((s) => (
              <CommandItem
                key={s.id}
                value={s.name}
                onSelect={() => {
                  if (page === 'deck:subject') {
                    close()
                    openCreate('deck', { subjectId: s.id })
                  } else {
                    setSearch('')
                    setCardSubjectId(s.id)
                    setPage('card:deck')
                  }
                }}
              >
                <SubjectDot color={s.color} />
                {s.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {page === 'card:deck' && (
          <CommandGroup heading={t('cmd.groups.decks')}>
            {cardDecks.length === 0 && (
              <CommandItem value="aucun deck" disabled>
                {t('cmd.noDecks')}
              </CommandItem>
            )}
            {cardDecks.map((d) => (
              <CommandItem
                key={d.id}
                value={d.name}
                onSelect={() => {
                  // Land on the deck's cards screen; the composer opens with `n`
                  // (no navigation flag — spec §2.5, decision reversed).
                  close()
                  void navigate({
                    to: '/subjects/$subjectId/decks/$deckId',
                    params: { subjectId: d.subjectId, deckId: d.id },
                  })
                }}
              >
                <SquareStack />
                {d.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
