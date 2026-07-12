import { useEffect, useState } from 'react'
import type { Deck } from '@engram/shared'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/ui/kbd'

export interface DeckFormValues {
  name: string
  description: string
}

/**
 * Create/edit a deck (spec §3). Name required (autofocus), description optional.
 * `subjectId` is implicit (route param). `⌘/Ctrl+Enter` submits.
 */
export function DeckFormDialog({
  open,
  onOpenChange,
  deck,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deck?: Deck
  onSubmit: (values: DeckFormValues) => void
}) {
  const [values, setValues] = useState<DeckFormValues>(() => initial(deck))
  const [error, setError] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(initial(deck))
      setError(false)
    }
  }, [open, deck])

  function submit() {
    if (values.name.trim().length === 0) {
      setError(true)
      return
    }
    onSubmit({ name: values.name.trim(), description: values.description.trim() })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{deck ? 'Modifier le deck' : 'Nouveau deck'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deck-name">Nom</Label>
            <Input
              id="deck-name"
              autoFocus
              value={values.name}
              onChange={(e) => {
                setValues((v) => ({ ...v, name: e.target.value }))
                if (error) setError(false)
              }}
              placeholder="ex. Automates finis"
              aria-invalid={error ? true : undefined}
              className={cn(error && 'border-danger')}
            />
            {error && <p className="text-2xs text-danger">Le nom est requis.</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deck-description">Description</Label>
            <Textarea
              id="deck-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              placeholder="Optionnel"
              className="min-h-16"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit}>
            Enregistrer{' '}
            <Kbd className="ml-1.5 border-accent-fg/30 bg-transparent text-accent-fg">⌘↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function initial(deck?: Deck): DeckFormValues {
  return { name: deck?.name ?? '', description: deck?.description ?? '' }
}
