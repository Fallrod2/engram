import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { ReviewScope } from '@/lib/api'
import { ReviewSession } from '@/features/review/review-session'

/**
 * Session scope (spec §3.1). At most one filter is set: from the Dashboard /
 * sidebar → none (all dues); from a subject → `subjectId`; from a deck →
 * `deckId`. The session is autonomous — it reads its own search params.
 */
export const reviewSearchSchema = z.object({
  deckId: z.string().optional(),
  subjectId: z.string().optional(),
})

export const Route = createFileRoute('/review')({
  validateSearch: reviewSearchSchema,
  component: ReviewRoute,
})

function ReviewRoute() {
  const search = Route.useSearch()
  const scope: ReviewScope = {
    ...(search.deckId ? { deckId: search.deckId } : {}),
    ...(search.subjectId ? { subjectId: search.subjectId } : {}),
  }
  // The session renders full-screen via a portal to document.body (spec §4.1),
  // so nothing occupies the shell's content slot here.
  return <ReviewSession scope={scope} />
}
