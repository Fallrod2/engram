import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { classifyExtractError, describeExtractError } from './errors'
import { DownscaleError } from './downscale'

describe('classifyExtractError', () => {
  it('503 → noVisionProvider', () => {
    expect(classifyExtractError(new ApiError(503, 'x', 'service_unavailable'))).toBe(
      'noVisionProvider',
    )
  })

  it('413 → tooLarge', () => {
    expect(classifyExtractError(new ApiError(413, 'x', 'payload_too_large'))).toBe('tooLarge')
  })

  it('400 HEIC → heic', () => {
    expect(
      classifyExtractError(new ApiError(400, 'Format HEIC non supporté…', 'validation_error')),
    ).toBe('heic')
  })

  it('400 unsupported type → unsupported', () => {
    expect(
      classifyExtractError(
        new ApiError(400, 'type d’image non supporté (jpg/png/webp)', 'validation_error'),
      ),
    ).toBe('unsupported')
  })

  it('400 empty extraction → illegible', () => {
    expect(
      classifyExtractError(new ApiError(400, 'aucun texte extrait de l’image', 'validation_error')),
    ).toBe('illegible')
  })

  it('client DownscaleError(unsupportedImage) → unsupported (no round-trip)', () => {
    expect(classifyExtractError(new DownscaleError('unsupportedImage'))).toBe('unsupported')
  })

  it('client DownscaleError(tooLarge) → tooLarge', () => {
    expect(classifyExtractError(new DownscaleError('tooLarge'))).toBe('tooLarge')
  })

  it('client DownscaleError(heic) → heic (no round-trip)', () => {
    expect(classifyExtractError(new DownscaleError('heic'))).toBe('heic')
    expect(describeExtractError(new DownscaleError('heic'))).toMatch(/HEIC/)
  })

  it('unknown error → generic', () => {
    expect(classifyExtractError(new Error('boom'))).toBe('generic')
  })
})

describe('describeExtractError', () => {
  it('produces a non-empty actionable message per kind', () => {
    expect(describeExtractError(new ApiError(503, 'x', 'service_unavailable'))).toMatch(/vision/i)
    expect(describeExtractError(new DownscaleError('tooLarge'))).toMatch(/volumineuse/i)
    expect(describeExtractError(new Error('boom'))).toMatch(/échoué/i)
  })
})
