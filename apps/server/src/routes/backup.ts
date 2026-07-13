import { Hono } from 'hono'
import { backupSchema, backupImportResultSchema } from '@engram/shared'
import { db } from '../db/client'
import { ok } from '../http/respond'
import { requireAdmin } from '../http/identity'
import { PayloadTooLargeError, ValidationError } from '../http/errors'
import { exportBackup, importBackup } from '../services/backup.service'

// Backup is whole-instance data movement → admin-only in v1 (spec §3). The gate
// returns 403 `forbidden` for a non-admin; under the dev bypass the default
// identity is the admin, so local + default e2e work unchanged. `requireAdmin`
// also yields the (admin) user id, which scopes the export/import to Alex.
export const backupRouter = new Hono()

/** Reject absurd uploads before parsing (belt-and-suspenders for a local tool). */
const MAX_BACKUP_BYTES = 256 * 1024 * 1024 // 256 MiB

backupRouter.get('/export', async (c) => {
  const dump = backupSchema.parse(await exportBackup(db, requireAdmin(c)))
  const date = new Date().toISOString().slice(0, 10)
  c.header('Content-Type', 'application/json; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="engram-backup-${date}.json"`)
  return c.body(JSON.stringify(dump))
})

backupRouter.post('/import', async (c) => {
  const userId = requireAdmin(c)
  const text = await c.req.text()
  if (text.length > MAX_BACKUP_BYTES) {
    throw new PayloadTooLargeError('backup file exceeds the maximum allowed size')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ValidationError('backup file is not valid JSON')
  }
  return ok(c, backupImportResultSchema, await importBackup(db, userId, raw))
})
