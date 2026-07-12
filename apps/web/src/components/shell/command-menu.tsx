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
  label: string
  to: string
  icon: LucideIcon
  keywords: string
}

/** Navigation actions (spec §2.3.1). Shortcuts come from `keymap.ts` (in sync). */
const NAV_ACTIONS: NavAction[] = [
  {
    label: "Aujourd'hui",
    to: '/',
    icon: LayoutDashboard,
    keywords: 'dashboard accueil home today',
  },
  {
    label: 'Session de révision',
    to: '/review',
    icon: GraduationCap,
    keywords: 'review réviser session study',
  },
  { label: 'Matières', to: '/subjects', icon: Layers, keywords: 'subjects matieres decks cartes' },
  {
    label: 'Planning',
    to: '/planning',
    icon: CalendarDays,
    keywords: 'planning calendrier calendar examens',
  },
  {
    label: 'Analytics',
    to: '/analytics',
    icon: ChartColumn,
    keywords: 'analytics stats statistiques progression',
  },
  { label: 'Import', to: '/import', icon: Upload, keywords: 'import upload notes pdf markdown' },
  {
    label: 'Réglages',
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
      ? 'Nouveau deck — choisir la matière'
      : page === 'card:subject'
        ? 'Nouvelle carte — choisir la matière'
        : page === 'card:deck'
          ? 'Nouvelle carte — choisir le deck'
          : null

  return (
    <CommandDialog open={commandOpen} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={page === 'root' ? 'Rechercher ou aller à…' : 'Filtrer…'}
        value={search}
        onValueChange={setSearch}
        onKeyDown={onInputKeyDown}
      />
      {stepHint && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-2xs text-text-faint">
          <span>{stepHint}</span>
          <span aria-hidden>·</span>
          <span>⌫ retour</span>
        </div>
      )}
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>

        {page === 'root' && (
          <>
            <CommandGroup heading="Navigation">
              {NAV_ACTIONS.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.keywords}`}
                  onSelect={() => go(item.to)}
                >
                  <item.icon />
                  {item.label}
                  {navChordFor(item.to) && (
                    <CommandShortcut>{navChordFor(item.to)}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading="Créer">
              <CommandItem
                value="Nouvelle matière créer ajouter subject new add"
                onSelect={() => {
                  close()
                  openCreate('subject')
                }}
              >
                <Layers />
                Nouvelle matière
              </CommandItem>
              <CommandItem
                value="Nouveau deck créer ajouter deck new add"
                onSelect={() => {
                  setSearch('')
                  setPage('deck:subject')
                }}
              >
                <SquareStack />
                Nouveau deck…
              </CommandItem>
              <CommandItem
                value="Nouvelle carte créer ajouter card flashcard new add"
                onSelect={() => {
                  setSearch('')
                  setPage('card:subject')
                }}
              >
                <SquarePen />
                Nouvelle carte…
              </CommandItem>
              <CommandItem
                value="Nouvel examen créer ajouter exam new add"
                onSelect={() => {
                  close()
                  openCreate('exam')
                }}
              >
                <GraduationCap />
                Nouvel examen
              </CommandItem>
              <CommandItem
                value="Importer des notes upload import pdf markdown"
                onSelect={() => go('/import')}
              >
                <Upload />
                Importer des notes
              </CommandItem>
            </CommandGroup>

            {totalDue > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Réviser">
                  <CommandItem
                    value="Réviser tout toutes les cartes review all"
                    onSelect={() => go('/review')}
                  >
                    <GraduationCap />
                    Réviser tout
                    <CommandShortcut>{totalDue}</CommandShortcut>
                  </CommandItem>
                  {dueSubjects.map(({ subject, due }) => (
                    <CommandItem
                      key={subject.id}
                      value={`Réviser ${subject.name} review`}
                      onSelect={() => reviewSubject(subject.id)}
                    >
                      <SubjectDot color={subject.color} />
                      Réviser « {subject.name} »<CommandShortcut>{due}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading="Préférences">
              <CommandItem
                value="Basculer le thème theme clair sombre dark light"
                onSelect={() => {
                  toggle()
                  close()
                }}
              >
                {resolved === 'dark' ? <Sun /> : <Moon />}
                Basculer le thème
                <CommandShortcut>{resolved === 'dark' ? 'Clair' : 'Sombre'}</CommandShortcut>
              </CommandItem>
              <CommandItem
                value="Afficher les raccourcis clavier keyboard shortcuts aide help"
                onSelect={() => {
                  close()
                  setShortcutsOpen(true)
                }}
              >
                <Keyboard />
                Afficher les raccourcis
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {(page === 'deck:subject' || page === 'card:subject') && (
          <CommandGroup heading="Matières">
            {subjects.length === 0 && (
              <CommandItem value="aucune matière" disabled>
                Aucune matière — crée-en une d'abord.
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
          <CommandGroup heading="Decks">
            {cardDecks.length === 0 && (
              <CommandItem value="aucun deck" disabled>
                Aucun deck dans cette matière.
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
