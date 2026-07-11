import { createFileRoute } from '@tanstack/react-router'
import { Layers, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/subjects')({
  component: SubjectsPage,
})

function SubjectsPage() {
  return (
    <EmptyState
      icon={Layers}
      title="Aucune matière pour l'instant."
      meta="0 matière · 0 deck · 0 carte"
      action={
        <Button>
          <Plus className="size-4" />
          Nouvelle matière
        </Button>
      }
    />
  )
}
