import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge recognises a font size by its t-shirt shape (`xs`, `2xl`, …),
 * so the card reading scale (`text-card`, `text-card-sm`…) would otherwise be
 * filed under *text color* and cancel out `text-text` / `text-text-muted`.
 * Registering the four tokens puts them back in the `font-size` group: they now
 * conflict with other sizes (correct) and never with a color (correct).
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['card', 'card-sm', 'card-md', 'card-lg'] }] } },
})

/** Merge conditional class names, resolving Tailwind conflicts last-wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Apply a partial patch to an object, skipping `undefined` values. Used for
 * optimistic updates so an omitted field never overwrites the current value
 * (important under `exactOptionalPropertyTypes`).
 */
export function mergeDefined<T extends object>(
  base: T,
  patch: { [K in keyof T]?: T[K] | undefined },
): T {
  const out = { ...base }
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value !== undefined) out[key] = value
  }
  return out
}
