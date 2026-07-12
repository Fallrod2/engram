import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { Card } from '@engram/shared'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/ui/kbd'
import { MarkdownPreview } from '@/lib/markdown-preview'

/**
 * Edit a card's front/back in a dialog (spec §4). Never touches FSRS state
 * (`updateCardSchema` = `{ front?, back? }`). `⌘/Ctrl+Enter` saves, `Esc` closes.
 */
export function CardEditDialog({
  open,
  onOpenChange,
  card,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: Card | null
  onSubmit: (values: { front: string; back: string }) => void
}) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [errors, setErrors] = useState({ front: false, back: false })
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    if (open && card) {
      setFront(card.front)
      setBack(card.back)
      setErrors({ front: false, back: false })
      setPreview(false)
    }
  }, [open, card])

  function submit() {
    const f = front.trim()
    const b = back.trim()
    const next = { front: f.length === 0, back: b.length === 0 }
    if (next.front || next.back) {
      setErrors(next)
      return
    }
    onSubmit({ front: f, back: b })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Modifier la carte</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-front">Recto</Label>
            <Textarea
              id="card-front"
              autoFocus
              value={front}
              onChange={(e) => {
                setFront(e.target.value)
                if (errors.front) setErrors((s) => ({ ...s, front: false }))
              }}
              aria-invalid={errors.front ? true : undefined}
              className={cn('min-h-20', errors.front && 'border-danger')}
            />
            {errors.front && <p className="text-2xs text-danger">Ce champ est requis.</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-back">Verso</Label>
            <Textarea
              id="card-back"
              value={back}
              onChange={(e) => {
                setBack(e.target.value)
                if (errors.back) setErrors((s) => ({ ...s, back: false }))
              }}
              aria-invalid={errors.back ? true : undefined}
              className={cn('min-h-20', errors.back && 'border-danger')}
            />
            {errors.back && <p className="text-2xs text-danger">Ce champ est requis.</p>}
            {preview && back.trim().length > 0 && (
              <div className="mt-1 rounded-sm border border-border bg-bg px-3 py-2 text-sm text-text">
                <MarkdownPreview source={back} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-muted"
            aria-pressed={preview}
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? <EyeOff /> : <Eye />}
            Markdown
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={submit}>
              Enregistrer{' '}
              <Kbd className="ml-1.5 border-accent-fg/30 bg-transparent text-accent-fg">⌘↵</Kbd>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
