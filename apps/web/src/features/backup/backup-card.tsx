import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { downloadBackup, importBackupFile } from './queries'

/**
 * Settings "Données" card: export the whole database as JSON, or restore a
 * backup file. Import is destructive (replace-all), so it goes through an
 * `AlertDialog` (focus defaults to Cancel) and, on success, clears every cache
 * and revalidates the router so the app reloads on the restored data.
 */
export function BackupCard() {
  const t = useT()
  const qc = useQueryClient()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const exportMutation = useMutation({
    mutationFn: downloadBackup,
    onSuccess: () => toast.success(t('settings.dataExportDone')),
    onError: (err) =>
      toast.error(
        err instanceof ApiError && err.code === 'forbidden'
          ? t('settings.adminOnly')
          : t('settings.dataExportError'),
      ),
  })

  const importMutation = useMutation({
    mutationFn: (file: File) => importBackupFile(file),
    onSuccess: async (result) => {
      qc.clear()
      await router.invalidate()
      toast.success(
        t('settings.dataImportDone', {
          subjects: result.inserted.subject,
          cards: result.inserted.card,
        }),
      )
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError && err.code === 'forbidden'
          ? t('settings.adminOnly')
          : err instanceof ApiError
            ? err.message
            : t('settings.dataImportError'),
      ),
    onSettled: () => setPendingFile(null),
  })

  function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    // Reset the input so picking the same file again still fires `change`.
    e.target.value = ''
    if (file) setPendingFile(file)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.dataTitle')}</CardTitle>
        <CardDescription>{t('settings.dataDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-text">{t('settings.dataExportLabel')}</span>
              <span className="text-xs text-text-muted">{t('settings.dataExportHint')}</span>
            </div>
            <Button
              variant="secondary"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
            >
              <Download className="size-4" aria-hidden />
              {t('settings.dataExportAction')}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text">{t('settings.dataImportLabel')}</span>
            <span className="text-xs text-text-muted">{t('settings.dataImportHint')}</span>
          </div>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
          >
            <Upload className="size-4" aria-hidden />
            {t('settings.dataImportAction')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            // Triggered by the button above; give it an accessible name and keep
            // it out of the tab order so it is not a nameless duplicate stop (a11y).
            aria-label={t('settings.dataImportAction')}
            tabIndex={-1}
            onChange={onFilePicked}
          />
        </div>
      </CardContent>

      <AlertDialog
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.dataImportConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.dataImportConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingFile) importMutation.mutate(pendingFile)
              }}
            >
              {t('settings.dataImportConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
