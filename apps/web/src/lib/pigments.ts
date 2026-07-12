/**
 * Subject pigment resolution (spec §2 "résolution pigment").
 *
 * The DB stores `subject.color` as a canonical `#rrggbb` hex (WS-B contract).
 * The design system exposes 8 themeable pigments as `--color-subject-N` tokens
 * that differ between dark and light. We reconcile the two: the picker only
 * offers these 8 canonical hexes, and rendering resolves a stored hex back to
 * its `var(--color-subject-N)` token so the color adapts to the theme.
 *
 * A hex that is not one of the 8 (legacy/import) falls back to its raw value —
 * still correct, just not theme-adaptive.
 */

/** A subject pigment slot (1-8) mapped to `--color-subject-N`. */
export type SubjectColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Pigment {
  slot: SubjectColor
  /** Canonical hex (the dark-theme sRGB value of the token). Persisted as-is. */
  hex: string
  /** Human label for the picker tooltip. */
  label: string
}

/**
 * The 8 canonical pigments. `hex` values are the sRGB rendering of each
 * `--subj-N` OKLCH token in dark mode (see `styles.css`), used as the stored
 * `subject.color`.
 */
export const SUBJECT_PIGMENTS = [
  { slot: 1, hex: '#7999f5', label: 'Indigo' },
  { slot: 2, hex: '#00b6be', label: 'Cyan' },
  { slot: 3, hex: '#3fbe90', label: 'Émeraude' },
  { slot: 4, hex: '#92be62', label: 'Lime' },
  { slot: 5, hex: '#d1b64a', label: 'Ambre' },
  { slot: 6, hex: '#eb7a52', label: 'Orange' },
  { slot: 7, hex: '#e06285', label: 'Rose' },
  { slot: 8, hex: '#ba71cb', label: 'Magenta' },
] as const satisfies readonly Pigment[]

const BY_HEX = new Map(SUBJECT_PIGMENTS.map((p) => [p.hex.toLowerCase(), p]))

/** The default pigment for a new subject. */
export const DEFAULT_PIGMENT = SUBJECT_PIGMENTS[0]

/**
 * Slot → Tailwind background utility (literal class names so Tailwind v4 emits
 * both the `--color-subject-N` custom property and the utility — an inline
 * `var(--color-subject-N)` would be tree-shaken away). Themeable in dark/light.
 */
export const SUBJECT_BG_CLASS: Record<SubjectColor, string> = {
  1: 'bg-subject-1',
  2: 'bg-subject-2',
  3: 'bg-subject-3',
  4: 'bg-subject-4',
  5: 'bg-subject-5',
  6: 'bg-subject-6',
  7: 'bg-subject-7',
  8: 'bg-subject-8',
}

/** Resolve a stored hex to its pigment slot, or `null` if it is not canonical. */
export function pigmentSlotForHex(hex: string): SubjectColor | null {
  return BY_HEX.get(hex.toLowerCase())?.slot ?? null
}

/**
 * A CSS color value for a stored hex: the themeable `var(--color-subject-N)`
 * token when the hex is canonical, else the raw hex.
 */
export function subjectColorValue(hex: string): string {
  const slot = pigmentSlotForHex(hex)
  return slot ? `var(--color-subject-${slot})` : hex
}
