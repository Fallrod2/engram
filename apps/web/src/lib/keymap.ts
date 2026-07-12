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
 * This module is pure (no React, no icons) so it is trivially unit-testable.
 */

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
  label: string
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
  label: string
}

export const NAV_CHORDS: readonly NavChord[] = [
  { key: 'd', to: '/', label: 'Aller à Aujourd’hui' },
  { key: 'r', to: '/review', label: 'Aller à la Session' },
  { key: 's', to: '/subjects', label: 'Aller aux Matières' },
  { key: 'p', to: '/planning', label: 'Aller au Planning' },
  { key: 'a', to: '/analytics', label: 'Aller aux Analytics' },
  { key: 'i', to: '/import', label: 'Aller à l’Import' },
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
  { keys: '⌘K', label: 'Palette de commandes', group: 'global' },
  { keys: '?', label: 'Afficher les raccourcis', group: 'global' },
  { keys: '[', label: 'Réduire / déployer la barre', group: 'global' },
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

/** Human label for the "current screen" help section. */
export const CONTEXT_LABELS: Record<ContextId, string> = {
  'subjects.index': 'Matières',
  'subjects.detail': 'Matière — decks',
  'deck.cards': 'Deck — cartes',
  'import.index': 'Import',
  'import.note': 'Note importée',
  'import.generation': 'Révision des cartes générées',
  planning: 'Planning',
  session: 'Session de révision',
}

/**
 * Per-screen hotkeys — the documentary mirror of each route's `useHotkeys`
 * (verified against the code at implementation time, spec §3.4.1). Roving lists
 * (`j / k` + `Entrée`) are documented where the screen mounts `useRovingList`.
 */
export const CONTEXT_KEYS: Record<ContextId, readonly KeyBinding[]> = {
  'subjects.index': [
    { keys: 'N', label: 'Nouvelle matière', group: 'subjects.index' },
    { keys: '/', label: 'Filtrer', group: 'subjects.index' },
    { keys: 'E', label: 'Éditer la matière', group: 'subjects.index' },
    { keys: 'A', label: 'Archiver / désarchiver', group: 'subjects.index' },
    { keys: 'X', label: 'Supprimer', group: 'subjects.index' },
    { keys: 'J K', label: 'Naviguer dans la liste', group: 'subjects.index' },
    { keys: 'Entrée', label: 'Ouvrir', group: 'subjects.index' },
  ],
  'subjects.detail': [
    { keys: 'N', label: 'Nouveau deck', group: 'subjects.detail' },
    { keys: 'E', label: 'Éditer le deck', group: 'subjects.detail' },
    { keys: 'X', label: 'Supprimer le deck', group: 'subjects.detail' },
    { keys: 'J K', label: 'Naviguer dans la liste', group: 'subjects.detail' },
    { keys: 'Entrée', label: 'Ouvrir', group: 'subjects.detail' },
  ],
  'deck.cards': [
    { keys: 'N', label: 'Nouvelle carte', group: 'deck.cards' },
    { keys: 'C', label: 'Composer une carte', group: 'deck.cards' },
    { keys: 'E', label: 'Éditer la carte', group: 'deck.cards' },
    { keys: 'X', label: 'Supprimer la carte', group: 'deck.cards' },
    { keys: 'J K', label: 'Naviguer dans la liste', group: 'deck.cards' },
    { keys: 'Entrée', label: 'Ouvrir', group: 'deck.cards' },
  ],
  'import.index': [
    { keys: 'E', label: 'Éditer la note', group: 'import.index' },
    { keys: 'X', label: 'Supprimer la note', group: 'import.index' },
    { keys: 'J K', label: 'Naviguer dans la liste', group: 'import.index' },
    { keys: 'Entrée', label: 'Ouvrir la note', group: 'import.index' },
  ],
  'import.note': [
    { keys: 'E', label: 'Éditer la note', group: 'import.note' },
    { keys: 'X', label: 'Supprimer la note', group: 'import.note' },
    { keys: 'G', label: 'Aller au deck cible', group: 'import.note' },
  ],
  'import.generation': [
    { keys: 'A', label: 'Accepter la carte', group: 'import.generation' },
    { keys: '⇧ A', label: 'Accepter toutes les cartes', group: 'import.generation' },
    { keys: 'R', label: 'Rejeter la carte', group: 'import.generation' },
    { keys: 'E', label: 'Éditer la carte', group: 'import.generation' },
    { keys: 'U', label: 'Annuler la décision', group: 'import.generation' },
    { keys: 'J K', label: 'Naviguer carte par carte', group: 'import.generation' },
    { keys: '⌘ Entrée', label: 'Insérer les cartes retenues', group: 'import.generation' },
  ],
  planning: [
    { keys: 'M', label: 'Vue mois', group: 'planning' },
    { keys: 'S', label: 'Vue semaine', group: 'planning' },
    { keys: 'N', label: 'Nouvel examen', group: 'planning' },
    { keys: 'T', label: 'Revenir à aujourd’hui', group: 'planning' },
    { keys: 'E', label: 'Éditer l’examen du jour', group: 'planning' },
    { keys: 'J K', label: 'Naviguer dans les examens', group: 'planning' },
  ],
  session: [
    { keys: 'Espace', label: 'Révéler la réponse', group: 'session' },
    { keys: '1 2 3 4', label: 'Noter la carte', group: 'session' },
    { keys: 'Échap', label: 'Quitter la session', group: 'session' },
    { keys: 'Q', label: 'Confirmer la sortie', group: 'session' },
    { keys: 'R', label: 'Recommencer une session', group: 'session' },
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
