/**
 * A tiny module-scoped hand-off for the photo-import flow: `File[]` cannot be
 * serialized into route search params, so the import list stashes the selected
 * photos here and navigates to `/import/photo`, which reads them ONCE. A direct
 * visit / refresh finds nothing → the route redirects back to `/import`.
 */
export interface PendingPhotos {
  files: File[]
  subjectId?: string
}

let pending: PendingPhotos | null = null

export function setPendingPhotos(p: PendingPhotos): void {
  pending = p
}

/** Read-and-clear: the photo route consumes it exactly once. */
export function takePendingPhotos(): PendingPhotos | null {
  const p = pending
  pending = null
  return p
}
