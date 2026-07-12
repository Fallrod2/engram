import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
