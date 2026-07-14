/**
 * Assembly state machine for the multi-photo OCR preview (OCR spec §3.3.1).
 *
 * The hard problem: an extraction still `pending` can resolve AFTER the user has
 * begun correcting the textarea, which would silently clobber their edits. The
 * fix is a DEFINITIVE freeze (`dirty`) at the very first manual keystroke:
 *
 *  - while `dirty === false`, every resolution / reorder / removal RE-ASSEMBLES
 *    `assembledText` from the per-page segments (join `\n\n---\n\n`);
 *  - once `dirty === true`, async resolutions write ONLY into `segments` (the
 *    pages), NEVER into `assembledText`; a non-blocking `staleSinceEdit` flag
 *    lets the UI offer an explicit "re-apply order" that overwrites on demand.
 *
 * Kept pure (no React) so the freeze rule is unit-tested directly.
 */

import type { OcrWarning } from '@engram/shared'

export const PAGE_SEPARATOR = '\n\n---\n\n'

export type OcrPageStatus = 'pending' | 'done' | 'error'

export interface OcrPage {
  id: string
  name: string
  status: OcrPageStatus
  /** Transcribed Markdown once `done` (the source of truth per page). */
  segment: string
  warnings: OcrWarning[]
  error?: string
}

export interface OcrState {
  pages: OcrPage[]
  /** The textarea content — what the user sees/edits. */
  assembledText: string
  /** Definitive freeze: true from the first manual edit onward. */
  dirty: boolean
  /** After the freeze, a later resolution/reorder happened → offer re-apply. */
  staleSinceEdit: boolean
}

export type OcrAction =
  | { type: 'resolved'; id: string; segment: string; warnings: OcrWarning[] }
  | { type: 'failed'; id: string; error: string }
  | { type: 'retryStart'; id: string }
  | { type: 'edit'; text: string }
  | { type: 'reapplyOrder' }
  | { type: 'move'; id: string; dir: -1 | 1 }
  | { type: 'remove'; id: string }

export function initOcrState(pages: { id: string; name: string }[]): OcrState {
  return {
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      status: 'pending',
      segment: '',
      warnings: [],
    })),
    assembledText: '',
    dirty: false,
    staleSinceEdit: false,
  }
}

/** Join the done, non-empty segments in the current page order. */
export function assemble(pages: OcrPage[]): string {
  return pages
    .filter((p) => p.status === 'done' && p.segment.trim().length > 0)
    .map((p) => p.segment)
    .join(PAGE_SEPARATOR)
}

/** True iff at least one page has produced usable text. */
export function hasAnySegment(pages: OcrPage[]): boolean {
  return pages.some((p) => p.status === 'done' && p.segment.trim().length > 0)
}

function moveById(pages: OcrPage[], id: string, dir: -1 | 1): OcrPage[] {
  const i = pages.findIndex((p) => p.id === id)
  if (i < 0) return pages
  const j = i + dir
  if (j < 0 || j >= pages.length) return pages
  const next = pages.slice()
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item!)
  return next
}

/**
 * Re-derive `assembledText` after a programmatic (non-user) change to the pages.
 * Respects the freeze: writes the textarea only while `!dirty`; once frozen it
 * merely raises `staleSinceEdit` (if there is content to re-apply).
 */
function afterPageChange(state: OcrState, pages: OcrPage[]): OcrState {
  if (!state.dirty) {
    return { ...state, pages, assembledText: assemble(pages), staleSinceEdit: false }
  }
  return { ...state, pages, staleSinceEdit: state.staleSinceEdit || hasAnySegment(pages) }
}

export function ocrReducer(state: OcrState, action: OcrAction): OcrState {
  switch (action.type) {
    case 'resolved': {
      // Rebuild the page WITHOUT an `error` key (exactOptionalPropertyTypes).
      const pages = state.pages.map((p): OcrPage =>
        p.id === action.id
          ? {
              id: p.id,
              name: p.name,
              status: 'done',
              segment: action.segment,
              warnings: action.warnings,
            }
          : p,
      )
      return afterPageChange(state, pages)
    }
    case 'failed': {
      // A failure adds no content → never touches the textarea or the freeze.
      const pages = state.pages.map((p) =>
        p.id === action.id ? { ...p, status: 'error' as const, error: action.error } : p,
      )
      return { ...state, pages }
    }
    case 'retryStart': {
      const pages = state.pages.map((p): OcrPage =>
        p.id === action.id
          ? { id: p.id, name: p.name, status: 'pending', segment: p.segment, warnings: p.warnings }
          : p,
      )
      return { ...state, pages }
    }
    case 'edit':
      // First keystroke freezes the assembly definitively.
      return { ...state, assembledText: action.text, dirty: true }
    case 'reapplyOrder':
      // Explicit user action: overwrite corrections with the ordered assembly.
      return { ...state, assembledText: assemble(state.pages), staleSinceEdit: false }
    case 'move':
      return afterPageChange(state, moveById(state.pages, action.id, action.dir))
    case 'remove':
      return afterPageChange(
        state,
        state.pages.filter((p) => p.id !== action.id),
      )
  }
}

/**
 * Concurrency pool size for the extractions (OCR spec §3.3.2). Desktop ~3;
 * mobile 2; sequential on a slow radio. Best-effort — never blocking. With the
 * mandatory downscale each upload is < 600 KB, so this is comfort, not a
 * necessity.
 */
interface NetworkInformation {
  effectiveType?: string
}
export function getExtractionConcurrency(): number {
  if (typeof navigator === 'undefined') return 3
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
  const et = conn?.effectiveType
  if (et && /(^|-)2g$|slow-2g|3g/.test(et)) return 1
  const mobile =
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 768px)')?.matches === true
  return mobile ? 2 : 3
}
