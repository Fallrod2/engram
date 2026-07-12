import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { classifyGenerationError, describeUploadError, isApiKeyError } from './errors'

describe('isApiKeyError', () => {
  it('matches a message mentioning ANTHROPIC_API_KEY, case-insensitively', () => {
    expect(isApiKeyError('AI generation unavailable: ANTHROPIC_API_KEY not configured')).toBe(true)
    expect(isApiKeyError('missing anthropic_api_key')).toBe(true)
  })
  it('is false for null/unrelated messages', () => {
    expect(isApiKeyError(null)).toBe(false)
    expect(isApiKeyError('rate limited')).toBe(false)
  })
})

describe('classifyGenerationError', () => {
  it('classifies a 503 service_unavailable as apiKeyMissing', () => {
    expect(classifyGenerationError(new ApiError(503, 'x', 'service_unavailable'))).toBe(
      'apiKeyMissing',
    )
  })
  it('classifies a 404 as notFound', () => {
    expect(classifyGenerationError(new ApiError(404, 'x', 'not_found'))).toBe('notFound')
  })
  it('detects an api-key message even on a generic status', () => {
    expect(
      classifyGenerationError(new ApiError(500, 'no ANTHROPIC_API_KEY', 'internal_error')),
    ).toBe('apiKeyMissing')
  })
  it('falls back to generic', () => {
    expect(classifyGenerationError(new ApiError(500, 'boom', 'internal_error'))).toBe('generic')
    expect(classifyGenerationError(new Error('network'))).toBe('generic')
  })
})

describe('describeUploadError', () => {
  it('maps 413 to a size message', () => {
    expect(describeUploadError(new ApiError(413, 'too big', 'payload_too_large'))).toMatch(/max 10/)
  })
  it('maps 400 to "Fichier illisible"', () => {
    expect(describeUploadError(new ApiError(400, 'nope', 'validation_error'))).toBe(
      'Fichier illisible',
    )
  })
  it('falls back to a generic message', () => {
    expect(describeUploadError(new Error('x'))).toBe("L'import a échoué")
  })
})
