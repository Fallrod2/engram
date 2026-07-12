/**
 * Central keyboard-shortcut table (spec §3.2). Single source consumed by:
 *  - the global handler in `shell-context.tsx` (g-chords, `?`, `[`),
 *  - the command palette (shortcuts shown on the right of nav actions),
 *  - the `ShortcutsDialog` (`?` help).
 *
 * The route-level `useHotkeys` handlers stay in their screens; `CONTEXT_KEYS`
 * is only their **documentary mirror**. Rule of coverage: every screen that
 * mounts a `useHotkeys` MUST appear in `CONTEXT_KEYS` (garde-fou §3.4.1), so the
 * help never silently omits a screen's shortcuts.
 *
 * This module is pure (no React, no icons — only a type-only i18n import, erased
 * at runtime) so it is trivially unit-testable. Labels are i18n keys resolved by
 * the `ShortcutsDialog` with `t(...)` (spec §9.4).
 */

import type { TKey } from '@/lib/i18n'

export type KeyGroup =
  | 'global'
  | 'nav'
  | 'subjects.index'
  | 'subjects.detail'
  | 'deck.cards'
  | 'import.index'
  | 'import.note'
  | 'import.generation'
  | 'planning'
  | 'session'

export interface KeyBinding {
  /** Space-separated key tokens, each rendered as one `<Kbd>` (e.g. `'G D'`). */
  keys: string
  /** i18n key, resolved with `t(...)` in the `ShortcutsDialog`. */
  label: TKey
  group: KeyGroup
}

/**
 * Global navigation chords (spec §3.3): `g` then a letter. The single letters
 * stay free for screen-local hotkeys — `g s` (chord) never collides with a
 * bare `s` (planning week) because the chord is prefixed. Second keys are all
 * distinct and never `g`.
 */
export interface NavChord {
  /** The second key of the chord (lowercase, single letter). */
  key: string
  to: string
  /** i18n key, resolved with `t(...)` in the `ShortcutsDialog`. */
  label: TKey
}

export const NAV_CHORDS: readonly NavChord[] = [
  { key: 'd', to: '/', label: 'shortcuts.chords.today' },
  { key: 'r', to: '/review', label: 'shortcuts.chords.session' },
  { key: 's', to: '/subjects', label: 'shortcuts.chords.subjects' },
  { key: 'p', to: '/planning', label: 'shortcuts.chords.planning' },
  { key: 'a', to: '/analytics', label: 'shortcuts.chords.analytics' },
  { key: 'i', to: '/import', label: 'shortcuts.chords.import' },
]

/** Display form of a chord, e.g. `'d'` → `'G D'`. */
export function chordDisplay(key: string): string {
  return `G ${key.toUpperCase()}`
}

/** The chord shown next to a nav action in the palette, or `undefined`. */
export function navChordFor(to: string): string | undefined {
  const c = NAV_CHORDS.find((chord) => chord.to === to)
  return c ? chordDisplay(c.key) : undefined
}

/** Non-nav global shortcuts (always active outside a field/session/modal). */
export const GLOBAL_KEYS: readonly KeyBinding[] = [
  { keys: '⌘K', label: 'shortcuts.global.palette', group: 'global' },
  { keys: '?', label: 'shortcuts.global.showShortcuts', group: 'global' },
  { keys: '[', label: 'shortcuts.global.toggleSidebar', group: 'global' },
]

/** Navigation chords, in display form, for the help dialog. */
export const NAV_KEYS: readonly KeyBinding[] = NAV_CHORDS.map((c) => ({
  keys: chordDisplay(c.key),
  label: c.label,
  group: 'nav',
}))

export type ContextId = Extract<
  KeyGroup,
  | 'subjects.index'
  | 'subjects.detail'
  | 'deck.cards'
  | 'import.index'
  | 'import.note'
  | 'import.generation'
  | 'planning'
  | 'session'
>

/** i18n key for the "current screen" help section label. */
export const CONTEXT_LABELS: Record<ContextId, TKey> = {
  'subjects.index': 'shortcuts.contextLabels.subjectsIndex',
  'subjects.detail': 'shortcuts.contextLabels.subjectsDetail',
  'deck.cards': 'shortcuts.contextLabels.deckCards',
  'import.index': 'shortcuts.contextLabels.importIndex',
  'import.note': 'shortcuts.contextLabels.importNote',
  'import.generation': 'shortcuts.contextLabels.importGeneration',
  planning: 'shortcuts.contextLabels.planning',
  session: 'shortcuts.contextLabels.session',
}

/**
 * Per-screen hotkeys — the documentary mirror of each route's `useHotkeys`
 * (verified against the code at implementation time, spec §3.4.1). Roving lists
 * (`j / k` + `Entrée`) are documented where the screen mounts `useRovingList`.
 */
export const CONTEXT_KEYS: Record<ContextId, readonly KeyBinding[]> = {
  'subjects.index': [
    { keys: 'N', label: 'shortcuts.keys.newSubject', group: 'subjects.index' },
    { keys: '/', label: 'shortcuts.keys.filter', group: 'subjects.index' },
    { keys: 'E', label: 'shortcuts.keys.editSubject', group: 'subjects.index' },
    { keys: 'A', label: 'shortcuts.keys.archive', group: 'subjects.index' },
    { keys: 'X', label: 'shortcuts.keys.delete', group: 'subjects.index' },
    { keys: 'J K', label: 'shortcuts.keys.listNav', group: 'subjects.index' },
    { keys: 'Entrée', label: 'shortcuts.keys.open', group: 'subjects.index' },
  ],
  'subjects.detail': [
    { keys: 'N', label: 'shortcuts.keys.newDeck', group: 'subjects.detail' },
    { keys: 'E', label: 'shortcuts.keys.editDeck', group: 'subjects.detail' },
    { keys: 'X', label: 'shortcuts.keys.deleteDeck', group: 'subjects.detail' },
    { keys: 'J K', label: 'shortcuts.keys.listNav', group: 'subjects.detail' },
    { keys: 'Entrée', label: 'shortcuts.keys.open', group: 'subjects.detail' },
  ],
  'deck.cards': [
    { keys: 'N', label: 'shortcuts.keys.newCard', group: 'deck.cards' },
    { keys: 'C', label: 'shortcuts.keys.composeCard', group: 'deck.cards' },
    { keys: 'E', label: 'shortcuts.keys.editCard', group: 'deck.cards' },
    { keys: 'X', label: 'shortcuts.keys.deleteCard', group: 'deck.cards' },
    { keys: 'J K', label: 'shortcuts.keys.listNav', group: 'deck.cards' },
    { keys: 'Entrée', label: 'shortcuts.keys.open', group: 'deck.cards' },
  ],
  'import.index': [
    { keys: 'E', label: 'shortcuts.keys.editNote', group: 'import.index' },
    { keys: 'X', label: 'shortcuts.keys.deleteNote', group: 'import.index' },
    { keys: 'J K', label: 'shortcuts.keys.listNav', group: 'import.index' },
    { keys: 'Entrée', label: 'shortcuts.keys.openNote', group: 'import.index' },
  ],
  'import.note': [
    { keys: 'E', label: 'shortcuts.keys.editNote', group: 'import.note' },
    { keys: 'X', label: 'shortcuts.keys.deleteNote', group: 'import.note' },
    { keys: 'G', label: 'shortcuts.keys.gotoDeck', group: 'import.note' },
  ],
  'import.generation': [
    { keys: 'A', label: 'shortcuts.keys.acceptCard', group: 'import.generation' },
    { keys: '⇧ A', label: 'shortcuts.keys.acceptAll', group: 'import.generation' },
    { keys: 'R', label: 'shortcuts.keys.rejectCard', group: 'import.generation' },
    { keys: 'E', label: 'shortcuts.keys.editCard', group: 'import.generation' },
    { keys: 'U', label: 'shortcuts.keys.undoDecision', group: 'import.generation' },
    { keys: 'J K', label: 'shortcuts.keys.cardByCard', group: 'import.generation' },
    { keys: '⌘ Entrée', label: 'shortcuts.keys.insertCards', group: 'import.generation' },
  ],
  planning: [
    { keys: 'M', label: 'shortcuts.keys.viewMonth', group: 'planning' },
    { keys: 'S', label: 'shortcuts.keys.viewWeek', group: 'planning' },
    { keys: 'N', label: 'shortcuts.keys.newExam', group: 'planning' },
    { keys: 'T', label: 'shortcuts.keys.backToToday', group: 'planning' },
    { keys: 'E', label: 'shortcuts.keys.editExam', group: 'planning' },
    { keys: 'J K', label: 'shortcuts.keys.examNav', group: 'planning' },
  ],
  session: [
    { keys: 'Espace', label: 'shortcuts.keys.reveal', group: 'session' },
    { keys: '1 2 3 4', label: 'shortcuts.keys.rate', group: 'session' },
    { keys: 'Échap', label: 'shortcuts.keys.exitSession', group: 'session' },
    { keys: 'Q', label: 'shortcuts.keys.confirmExit', group: 'session' },
    { keys: 'R', label: 'shortcuts.keys.restartSession', group: 'session' },
  ],
}

/**
 * Resolve a pathname to its help context (spec §3.4.1), matching most-specific
 * first. Returns `null` for screens without a documented hotkey context.
 */
export function contextForPathname(pathname: string): ContextId | null {
  if (pathname === '/review') return 'session'
  if (/^\/import\/[^/]+\/generations\/[^/]+/.test(pathname)) return 'import.generation'
  if (/^\/import\/[^/]+/.test(pathname)) return 'import.note'
  if (pathname === '/import') return 'import.index'
  if (/^\/subjects\/[^/]+\/decks\/[^/]+/.test(pathname)) return 'deck.cards'
  if (/^\/subjects\/[^/]+/.test(pathname)) return 'subjects.detail'
  if (pathname === '/subjects') return 'subjects.index'
  if (pathname === '/planning') return 'planning'
  return null
}
