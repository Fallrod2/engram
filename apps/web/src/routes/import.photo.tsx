import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/components/empty-state'
import { subjectsListOptions } from '@/features/subjects/queries'
import { PhotoImport } from '@/features/ocr/photo-import'
import { takePendingPhotos, type PendingPhotos } from '@/features/ocr/pending'

export const Route = createFileRoute('/import/photo')({
  loader: ({ context }) => context.queryClient.ensureQueryData(subjectsListOptions()),
  component: ImportPhotoPage,
})

function ImportPhotoPage() {
  const subjects = useQuery(subjectsListOptions()).data ?? []
  // Read-and-clear the hand-off exactly once (Files can't ride in search params).
  // NO auto-redirect effect on empty: a stray re-mount during the create-note
  // navigation would otherwise `replace('/import')` and cancel it. A direct
  // visit / refresh simply renders the empty state with a manual link back.
  const [pending] = useState<PendingPhotos | null>(() => takePendingPhotos())

  if (!pending || pending.files.length === 0) {
    return (
      <EmptyState
        title="Aucune photo à importer"
        meta="Retournez à l’import pour choisir des photos de cours."
        action={<Link to="/import">Retour à l’import</Link>}
      />
    )
  }

  return (
    <PhotoImport
      files={pending.files}
      subjects={subjects}
      {...(pending.subjectId ? { subjectId: pending.subjectId } : {})}
    />
  )
}
