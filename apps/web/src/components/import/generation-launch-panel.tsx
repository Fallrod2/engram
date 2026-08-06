import { type ReactNode } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import type { Deck, GenerationKind, Subject } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubjectDot } from '@/components/subject-dot'

export interface DeckGroup {
  subject: Subject
  decks: Deck[]
}

/**
 * Generation launch panel (spec §3.3). Type (Cartes/Quiz) + required target deck
 * (grouped by subject) + a single accent CTA. `⌘↵` launches. The deck is fixed
 * at launch (the resolve carries no deck), so "Générer" is disabled until one is
 * chosen; it's also disabled when the note has no extractable text.
 */
export function GenerationLaunchPanel({
  kind,
  onKindChange,
  deckId,
  onDeckChange,
  deckGroups,
  contentEmpty,
  onLaunch,
  pending,
  onNewDeck,
  banner,
  providerUnavailable = false,
  demoNoSpend = false,
}: {
  kind: GenerationKind
  onKindChange: (kind: GenerationKind) => void
  deckId: string | undefined
  onDeckChange: (deckId: string) => void
  deckGroups: DeckGroup[]
  contentEmpty: boolean
  onLaunch: () => void
  pending: boolean
  /** Opens the "new deck" dialog; omit to hide the link (note has no subject). */
  onNewDeck?: () => void
  /** e.g. `<ApiKeyMissingBanner />` when the key is missing. */
  banner?: ReactNode
  /**
   * No AI provider can run as configured (T-031). Disables the launch — the
   * server's 503 stays the real guard, this is only the courtesy of saying so
   * BEFORE the visitor picks a type, creates a target deck and clicks.
   */
  providerUnavailable?: boolean
  /**
   * The caller is the DEMO account (T-058). It only changes the WORDING of the
   * blocker — `providerUnavailable` still does the disabling — because "no
   * provider configured" is true here and useless: the demo would be refused
   * with a key too (`requireNotDemoSpend`), and its AI config is read-only.
   */
  demoNoSpend?: boolean
}) {
  const t = useT()
  const noDecks = deckGroups.every((g) => g.decks.length === 0)
  const canLaunch = !!deckId && !contentEmpty && !pending && !providerUnavailable
  // Ordered by which blocker the visitor should fix first: a missing provider
  // makes the deck and the content irrelevant. The demo reason outranks it —
  // both are true of a demo visitor and only one of them leads anywhere.
  const hint = demoNoSpend
    ? t('generation.demoNoSpendHint')
    : providerUnavailable
      ? t('generation.noProviderHint')
      : contentEmpty
        ? t('generation.hintEmpty')
        : !deckId
          ? t('generation.hintNoDeck')
          : null

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canLaunch) {
          e.preventDefault()
          onLaunch()
        }
      }}
    >
      {banner}

      <Tabs value={kind} onValueChange={(v) => onKindChange(v as GenerationKind)}>
        <TabsList className="w-full">
          <TabsTrigger value="cards" className="flex-1">
            {t('generation.kindCards')}
          </TabsTrigger>
          <TabsTrigger value="quiz" className="flex-1">
            {t('generation.kindQuiz')}
          </TabsTrigger>
          <TabsTrigger value="mixed" className="flex-1">
            {t('generation.mixedTab')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === 'mixed' && (
        <p className="-mt-1 text-2xs text-text-faint">{t('generation.mixedDescription')}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-faint">
          {t('generation.targetDeck')}
        </label>
        {noDecks ? (
          <p className="text-xs text-text-muted">
            {t('generation.noDecks')}{' '}
            {onNewDeck && (
              <button
                type="button"
                onClick={onNewDeck}
                className="text-accent underline-offset-2 hover:underline"
              >
                {t('generation.createDeck')}
              </button>
            )}
          </p>
        ) : (
          <Select value={deckId ?? ''} onValueChange={onDeckChange}>
            {/* `data-deck-select` is the stable hook the route's `g` shortcut
                focuses. It used to query `[aria-label="Deck cible"]`, i.e. the
                FRENCH label — so the shortcut silently did nothing as soon as
                the UI was in English. A11y text must never double as a selector. */}
            <SelectTrigger data-deck-select aria-label={t('generation.targetDeck')}>
              <SelectValue placeholder={t('generation.chooseDeck')} />
            </SelectTrigger>
            <SelectContent>
              {deckGroups
                .filter((g) => g.decks.length > 0)
                .map((g) => (
                  <SelectGroup key={g.subject.id}>
                    <SelectLabel className="flex items-center gap-1.5">
                      <SubjectDot color={g.subject.color} />
                      {g.subject.name}
                    </SelectLabel>
                    {g.decks.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
            </SelectContent>
          </Select>
        )}
        {onNewDeck && !noDecks && (
          <button
            type="button"
            onClick={onNewDeck}
            className="mt-0.5 inline-flex w-fit items-center gap-1 text-2xs text-text-faint transition-colors hover:text-text-muted"
          >
            <Plus className="size-3" />
            {t('decks.new')}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-text-faint">
          {hint ?? (
            <span className="inline-flex items-center gap-1">
              <Kbd>⌘↵</Kbd> {t('generation.kbdGenerate')}
            </span>
          )}
        </span>
        <Button onClick={onLaunch} disabled={!canLaunch}>
          <Sparkles />
          {t('generation.generate')}
        </Button>
      </div>
    </div>
  )
}
