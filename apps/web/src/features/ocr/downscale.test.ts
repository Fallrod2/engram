import { describe, expect, it } from 'vitest'
import {
  computeTargetSize,
  downscaleImage,
  DownscaleError,
  MAX_BYTES,
  MAX_DIMENSION,
  type DownscaleDeps,
} from './downscale'

describe('computeTargetSize', () => {
  it('scales a large landscape photo to the long-side cap, preserving ratio', () => {
    const { width, height } = computeTargetSize(4000, 3000, MAX_DIMENSION)
    expect(width).toBe(MAX_DIMENSION)
    expect(height).toBe(1176) // 3000 * (1568/4000)
  })

  it('scales a portrait photo on its (taller) long side', () => {
    const { width, height } = computeTargetSize(3000, 4000, MAX_DIMENSION)
    expect(height).toBe(MAX_DIMENSION)
    expect(width).toBe(1176)
  })

  it('leaves an already-small image unscaled', () => {
    expect(computeTargetSize(800, 600, MAX_DIMENSION)).toEqual({ width: 800, height: 600 })
  })
})

interface FakeOpts {
  bw: number
  bh: number
  blobSize?: number
  failDecode?: boolean
}

function fakeDeps(opts: FakeOpts) {
  let captured: { width: number; height: number } | undefined
  const deps: DownscaleDeps = {
    createBitmap: async () => {
      if (opts.failDecode) throw new Error('decode failed')
      return { width: opts.bw, height: opts.bh }
    },
    makeCanvas: (width, height) => {
      captured = { width, height }
      return {
        width,
        height,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (b: Blob | null) => void, type?: string) =>
          cb(new Blob([new Uint8Array(opts.blobSize ?? 1000)], { type: type ?? 'image/jpeg' })),
      }
    },
  }
  return { deps, getCaptured: () => captured }
}

describe('downscaleImage', () => {
  it('reduces a large photo to ≤ MAX_DIMENSION and returns a JPEG blob', async () => {
    const { deps, getCaptured } = fakeDeps({ bw: 4032, bh: 3024, blobSize: 400_000 })
    const res = await downscaleImage(new Blob([new Uint8Array([1, 2, 3])]), deps)
    expect(res.mediaType).toBe('image/jpeg')
    expect(res.blob.size).toBe(400_000)
    const c = getCaptured()!
    expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(MAX_DIMENSION)
    expect(c.width).toBe(MAX_DIMENSION)
  })

  it('rejects with unsupportedImage when decode fails (HEIC / corrupt)', async () => {
    const { deps } = fakeDeps({ bw: 0, bh: 0, failDecode: true })
    await expect(downscaleImage(new Blob([new Uint8Array([0])]), deps)).rejects.toMatchObject({
      code: 'unsupportedImage',
    })
  })

  it('rejects with tooLarge when the blob stays over the cap after the quality fallback', async () => {
    const { deps } = fakeDeps({ bw: 4000, bh: 3000, blobSize: MAX_BYTES + 1 })
    await expect(downscaleImage(new Blob([new Uint8Array([0])]), deps)).rejects.toBeInstanceOf(
      DownscaleError,
    )
    await expect(downscaleImage(new Blob([new Uint8Array([0])]), deps)).rejects.toMatchObject({
      code: 'tooLarge',
    })
  })
})
