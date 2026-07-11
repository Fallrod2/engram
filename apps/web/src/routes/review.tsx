import { createFileRoute, Link } from '@tanstack/react-router'
import { GraduationCap, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/review')({
  component: ReviewPage,
})

function ReviewPage() {
  return (
    <EmptyState
      icon={GraduationCap}
      title="File de révision vide."
      meta="0 carte due maintenant"
      action={
        <Button asChild variant="outline">
          <Link to="/subjects">
            <Layers className="size-4" />
            Ajouter des cartes
          </Link>
        </Button>
      }
    />
  )
}
