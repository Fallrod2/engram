import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { classifyExtractError, ocrErrorMessageKey } from './errors'
import { DownscaleError } from './downscale'

describe('classifyExtractError', () => {
  it('503 without a structured reason → noVisionProvider (generic)', () => {
    expect(classifyExtractError(new ApiError(503, 'x', 'service_unavailable'))).toBe(
      'noVisionProvider',
    )
  })

  it('503 details.reason=no_provider → noProvider', () => {
    expect(
      classifyExtractError(
        new ApiError(503, 'x', 'service_unavailable', { reason: 'no_provider' }),
      ),
    ).toBe('noProvider')
  })

  it('503 details.reason=no_vision → noVision', () => {
    expect(
      classifyExtractError(new ApiError(503, 'x', 'service_unavailable', { reason: 'no_vision' })),
    ).toBe('noVision')
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
  })

  it('unknown error → generic', () => {
    expect(classifyExtractError(new Error('boom'))).toBe('generic')
  })
})

describe('ocrErrorMessageKey', () => {
  it('maps each error kind to its dict key', () => {
    expect(ocrErrorMessageKey('noProvider')).toBe('ocr.error.noProvider')
    expect(ocrErrorMessageKey('noVision')).toBe('ocr.error.noVision')
    expect(ocrErrorMessageKey('noVisionProvider')).toBe('ocr.error.noVisionProvider')
    expect(ocrErrorMessageKey('heic')).toBe('ocr.error.heic')
    expect(ocrErrorMessageKey('unsupported')).toBe('ocr.error.unsupported')
    expect(ocrErrorMessageKey('tooLarge')).toBe('ocr.error.tooLarge')
    expect(ocrErrorMessageKey('illegible')).toBe('ocr.error.illegible')
    expect(ocrErrorMessageKey('generic')).toBe('ocr.error.generic')
  })

  it('falls back to the generic key for an unknown or undefined kind', () => {
    expect(ocrErrorMessageKey(undefined)).toBe('ocr.error.generic')
    expect(ocrErrorMessageKey('boom')).toBe('ocr.error.generic')
  })
})
