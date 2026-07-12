import type { ReactNode } from 'react'

/**
 * A discreet low-data caption (spec §7): shown when a trend chart has too few
 * measured points to draw a meaningful line/area. We render the bare point(s)
 * plus this note instead of a filled area, which would imply a trend the data
 * doesn't support.
 */
export function LowDataNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 font-mono text-2xs text-text-faint">{children}</p>
}
