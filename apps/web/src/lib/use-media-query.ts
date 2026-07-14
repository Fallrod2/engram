import { useEffect, useState } from 'react'

/** Reactively track a CSS media query (SSR-safe: assumes no match on first paint). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia !== 'undefined' ? matchMedia(query).matches : false,
  )

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * True on touch-first devices (phones, tablets) where the primary pointer is
 * imprecise. Used to swap keyboard-only affordances (`<Kbd>` hints, "Space to
 * reveal") for tap-friendly controls, and to hide keyboard shortcut hints that
 * are meaningless without a keyboard (fix-session findings §1 & §3).
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}
