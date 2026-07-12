import { backupImportResultSchema, type BackupImportResult } from '@engram/shared'
import { api, ApiError } from '@/lib/api'

/**
 * Backup panel data layer. Export is a file download (not a typed DTO), so it
 * bypasses the `api` client and streams the attachment straight to disk. Import
 * posts the parsed dump through the typed client so the server's 400/409 guards
 * surface as `ApiError` with a human message.
 */

/** Fetch `GET /api/backup/export` and save the attachment to the user's disk. */
export async function downloadBackup(): Promise<void> {
  const res = await fetch('/api/backup/export')
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`)
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const filename = match?.[1] ?? `engram-backup-${new Date().toISOString().slice(0, 10)}.json`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Read, parse, and POST a backup file, returning the per-table insert counts. */
export async function importBackupFile(file: File): Promise<BackupImportResult> {
  const text = await file.text()
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new ApiError(400, 'Fichier illisible : JSON invalide')
  }
  return api.post('/backup/import', raw, backupImportResultSchema)
}
