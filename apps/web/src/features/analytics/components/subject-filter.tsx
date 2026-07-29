import type { Subject } from '@engram/shared'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubjectDot } from '@/components/subject-dot'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The Analytics screen's second filter rank: every subject, or one.
 *
 * Radix forbids an empty item value, hence the sentinel. "All subjects" is the
 * default and the first item, so the screen the batch shipped with — the
 * comparison — stays one keystroke away from any narrowed view: this is a filter
 * you toggle while reading, not a place you navigate to.
 *
 * Archived subjects are OFFERED (unlike the note picker): archiving hides a
 * subject from lists you did not ask for, it does not erase its history, and
 * "how did that one go" is a legitimate question about a subject you have put
 * away. They are dimmed, and sorted after the active ones.
 */
export const ALL_SUBJECTS = '__all__'

export function SubjectFilter({
  subjects,
  value,
  onChange,
}: {
  subjects: Subject[]
  /** `undefined` = every subject. */
  value: string | undefined
  onChange: (subjectId: string | undefined) => void
}) {
  const t = useT()
  const ordered = [...subjects].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      a.position - b.position ||
      a.name.localeCompare(b.name),
  )

  return (
    <Select
      value={value ?? ALL_SUBJECTS}
      onValueChange={(next) => onChange(next === ALL_SUBJECTS ? undefined : next)}
    >
      {/* The trigger keeps ONE line whatever the subject is called: a long name
          used to wrap and make this control taller than the window filter beside
          it, which shifted the whole header row. */}
      <SelectTrigger
        aria-label={t('analytics.subjectFilterAria')}
        className="w-56 whitespace-nowrap"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_SUBJECTS}>{t('analytics.allSubjects')}</SelectItem>
        {ordered.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="flex min-w-0 items-center gap-1.5">
              <SubjectDot color={s.color} muted={s.archived} />
              <span className={cn('truncate', s.archived && 'text-text-muted')}>{s.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
