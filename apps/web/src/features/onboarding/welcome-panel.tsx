import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Layers, Loader2, Sparkles, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WelcomeIllustration } from '@/components/illustrations'
import { seedExample } from './seed'

/**
 * First-visit onboarding (spec §6). Rendered ONLY when the DB is empty
 * (`subjects.length === 0`), in place of the hero — a calm, actionable welcome,
 * never a blocking overlay. Data presence IS the "seen" flag: it disappears the
 * moment a subject exists, so there is nothing to persist.
 */
export function WelcomePanel({ onCreateSubject }: { onCreateSubject: () => void }) {
  const qc = useQueryClient()
  const [seeding, setSeeding] = useState(false)

  async function loadExample() {
    setSeeding(true)
    try {
      await seedExample(qc)
      toast.success('Exemple chargé')
    } catch {
      toast.error("Le chargement de l'exemple a échoué")
    } finally {
      setSeeding(false)
    }
  }

  return (
    <section className="relative overflow-hidden rounded-lg border border-border bg-surface-1 p-8">
      <span className="pointer-events-none absolute right-6 top-6 text-text-faint/50" aria-hidden>
        <WelcomeIllustration />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-text">
          Bienvenue dans engram.
        </h2>
        <p className="text-sm text-text-muted">
          Crée ta première matière, ou charge un exemple pour explorer.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button onClick={onCreateSubject}>
          <Layers />
          Créer une matière
        </Button>
        <Button variant="secondary" asChild>
          <Link to="/import">
            <Upload />
            Importer des notes
          </Link>
        </Button>
        <Button variant="ghost" onClick={() => void loadExample()} disabled={seeding}>
          {seeding ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Charger un exemple
        </Button>
      </div>
    </section>
  )
}
