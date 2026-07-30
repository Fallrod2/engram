import { CalendarClock, X } from 'lucide-react'
import type { Deck, Subject } from '@engram/shared'
import { FSRS_STATE_BY_NAME, fsrsStateNameSchema, type FsrsStateName } from '@engram/shared'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { SubjectDot } from '@/components/subject-dot'
import { FSRS_STATE_LABEL_KEYS } from '@/components/fsrs-state-glyph'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { activeFilterCount, type SearchRouteSearch } from '../params'

/** Radix forbids an empty item value, so "no filter" needs a sentinel. */
const ANY = '__any__'

export interface FilterPatch {
  subject?: string | undefined
  deck?: string | undefined
  state?: FsrsStateName | undefined
  overdue?: boolean | undefined
  hideArchived?: boolean | undefined
}

/**
 * The filter rank of the search screen. Every control writes straight to the
 * URL (the caller navigates) — nothing here holds state, so a shared link and a
 * Back button reproduce the exact view.
 *
 * ARCHIVED SUBJECTS ARE OFFERED, and their cards are found by default:
 * archiving takes a subject out of rotation, it does not delete it, and a card
 * that cannot be found reads as data loss. "Hide archived" is the opt-out.
 */
export function SearchFilters({
  value,
  subjects,
  decks,
  onChange,
  onReset,
}: {
  value: SearchRouteSearch
  subjects: Subject[]
  decks: Deck[]
  onChange: (patch: FilterPatch) => void
  onReset: () => void
}) {
  const t = useT()
  const activeCount = activeFilterCount(value)

  const orderedSubjects = [...subjects].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      a.position - b.position ||
      a.name.localeCompare(b.name),
  )
  // A deck list narrowed to the chosen subject: offering the other 40 decks
  // would let the user build a filter pair that can only ever return nothing.
  const visibleDecks = value.subject ? decks.filter((d) => d.subjectId === value.subject) : decks

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.subject ?? ANY}
        onValueChange={(next) =>
          // Changing subject drops the deck: the previous deck almost certainly
          // belongs to the previous subject, and keeping it would silently
          // produce an empty result set that looks like "you have nothing here".
          onChange({ subject: next === ANY ? undefined : next, deck: undefined })
        }
      >
        <SelectTrigger aria-label={t('search.filters.subject')} className="w-48 whitespace-nowrap">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('search.filters.subjectAll')}</SelectItem>
          {orderedSubjects.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              <span className="flex min-w-0 items-center gap-1.5">
                <SubjectDot color={s.color} muted={s.archived} />
                <span className={cn('truncate', s.archived && 'text-text-muted')}>{s.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.deck ?? ANY}
        onValueChange={(next) => onChange({ deck: next === ANY ? undefined : next })}
      >
        <SelectTrigger aria-label={t('search.filters.deck')} className="w-44 whitespace-nowrap">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('search.filters.deckAll')}</SelectItem>
          {visibleDecks.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="truncate">{d.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.state ?? ANY}
        onValueChange={(next) =>
          onChange({ state: next === ANY ? undefined : fsrsStateNameSchema.parse(next) })
        }
      >
        <SelectTrigger aria-label={t('search.filters.state')} className="w-40 whitespace-nowrap">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('search.filters.stateAll')}</SelectItem>
          {fsrsStateNameSchema.options.map((name) => (
            <SelectItem key={name} value={name}>
              {/* The wire form is a NAME, the glyph vocabulary is keyed by the
                  ts-fsrs INTEGER: `FSRS_STATE_BY_NAME` is the shared map between
                  the two, so the label can never drift from the filter. */}
              {t(FSRS_STATE_LABEL_KEYS[FSRS_STATE_BY_NAME[name]])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FilterToggle
        icon={<CalendarClock className="size-3.5" />}
        label={t('search.filters.overdue')}
        pressed={value.overdue === true}
        onPressedChange={(on) => onChange({ overdue: on ? true : undefined })}
      />
      <FilterToggle
        label={t('search.filters.hideArchived')}
        pressed={value.hideArchived === true}
        onPressedChange={(on) => onChange({ hideArchived: on ? true : undefined })}
      />

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="text-text-muted" onClick={onReset}>
          <X />
          {t('search.filters.clear')}
        </Button>
      )}
    </div>
  )
}

/**
 * A pressed-state chip rather than a switch: these are list filters, read at a
 * glance in a row of other filters, and `aria-pressed` is the button semantic
 * that says "this one is on" without inventing a form control.
 */
function FilterToggle({
  icon,
  label,
  pressed,
  onPressedChange,
}: {
  icon?: React.ReactNode
  label: string
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-sm border px-3 text-sm',
        'transition-colors duration-fast',
        pressed
          ? 'border-accent bg-accent-subtle text-accent'
          : 'border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
