import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/` redirects to `/subjects` in Phase 1 (spec §1.1). It becomes
 * `/review/today` in Phase 2 (session de révision).
 */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/subjects' })
  },
})
