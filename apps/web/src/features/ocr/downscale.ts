/**
 * MANDATORY client-side downscale (OCR spec §1.2 / §3.1.1). The Vercel Node
 * serverless body cap (4.5 MB) is applied by the platform BEFORE our handler, so
 * a raw phone photo (5–12 MB) must be shrunk in the browser BEFORE upload — the
 * server cannot rescue it. We also cap the cost: ~1568 px on the long side is
 * the Anthropic "optimal" bound, ~200–600 KB re-encoded to JPEG q≈0.85.
 *
 * The DOM parts (decode + canvas) are dependency-injected so the ratio/retry
 * logic is unit-testable in Node; the pixel-exact behaviour is covered by an
 * e2e browser run.
 */

/** Long-side ceiling in pixels (Anthropic optimal bound). */
export const MAX_DIMENSION = 1568
/** Hard byte cap after downscale — matches the server guard-rail. */
export const MAX_BYTES = 4 * 1024 * 1024
/** Encode quality steps: try high, then fall back once before giving up. */
const QUALITY_STEPS = [0.85, 0.7] as const

export type DownscaleErrorCode = 'unsupportedImage' | 'tooLarge' | 'heic'

export class DownscaleError extends Error {
  readonly code: DownscaleErrorCode
  constructor(code: DownscaleErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'DownscaleError'
    this.code = code
  }
}

export interface DownscaleResult {
  blob: Blob
  mediaType: 'image/jpeg'
}

interface Bitmap {
  width: number
  height: number
  close?(): void
}

interface CanvasLike {
  width: number
  height: number
  getContext(
    id: '2d',
  ): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null
  toBlob?(cb: (b: Blob | null) => void, type?: string, quality?: number): void
  convertToBlob?(opts?: { type?: string; quality?: number }): Promise<Blob>
}

export interface DownscaleDeps {
  createBitmap(file: Blob): Promise<Bitmap>
  makeCanvas(width: number, height: number): CanvasLike
}

/**
 * Fit `(w, h)` inside a `max`-pixel long side, preserving aspect ratio. An image
 * already within bounds is returned unscaled (rounded). Pure — the unit-test
 * anchor for the scaling maths.
 */
export function computeTargetSize(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { width: Math.round(w), height: Math.round(h) }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

async function canvasToBlob(canvas: CanvasLike, quality: number): Promise<Blob | null> {
  if (canvas.convertToBlob) {
    try {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality })
    } catch {
      return null
    }
  }
  if (canvas.toBlob) {
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob!((b) => resolve(b), 'image/jpeg', quality),
    )
  }
  return null
}

const defaultDeps: DownscaleDeps = {
  createBitmap: (file) =>
    createImageBitmap(file, { imageOrientation: 'from-image' }) as unknown as Promise<Bitmap>,
  makeCanvas: (width, height) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
    const el = document.createElement('canvas')
    el.width = width
    el.height = height
    return el as unknown as CanvasLike
  },
}

/**
 * Decode → fit to `MAX_DIMENSION` → re-encode JPEG. A decode failure (HEIC or a
 * corrupt/unsupported file) rejects with `unsupportedImage` (no upload); a blob
 * still over `MAX_BYTES` after the quality fallback rejects with `tooLarge`.
 */
export async function downscaleImage(
  file: Blob,
  deps: DownscaleDeps = defaultDeps,
): Promise<DownscaleResult> {
  let bitmap: Bitmap
  try {
    bitmap = await deps.createBitmap(file)
  } catch {
    throw new DownscaleError('unsupportedImage', 'image illisible ou format non supporté')
  }

  try {
    const { width, height } = computeTargetSize(bitmap.width, bitmap.height, MAX_DIMENSION)
    const canvas = deps.makeCanvas(width, height)
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new DownscaleError('unsupportedImage', 'canvas 2D indisponible')
    ctx.drawImage(bitmap, 0, 0, width, height)

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob && blob.size <= MAX_BYTES) return { blob, mediaType: 'image/jpeg' }
    }
    throw new DownscaleError('tooLarge', 'image trop volumineuse même après réduction')
  } finally {
    bitmap.close?.()
  }
}
