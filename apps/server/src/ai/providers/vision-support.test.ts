import { describe, expect, it } from 'vitest'
import {
  anthropicSupportsVision,
  ollamaSupportsVision,
  openAiCompatSupportsVision,
} from './vision-support'

describe('anthropicSupportsVision', () => {
  it('accepts modern Claude models', () => {
    expect(anthropicSupportsVision('claude-sonnet-4-6')).toBe(true)
    expect(anthropicSupportsVision('claude-3-5-sonnet-latest')).toBe(true)
  })
  it('rejects legacy text-only Claude models', () => {
    expect(anthropicSupportsVision('claude-2.1')).toBe(false)
    expect(anthropicSupportsVision('claude-instant-1.2')).toBe(false)
  })
})

describe('ollamaSupportsVision', () => {
  it('accepts known vision families', () => {
    expect(ollamaSupportsVision('llava:7b')).toBe(true)
    expect(ollamaSupportsVision('moondream')).toBe(true)
    expect(ollamaSupportsVision('gemma3:12b')).toBe(true)
    expect(ollamaSupportsVision('llama3.2-vision:11b')).toBe(true)
  })
  it('rejects text-only local models', () => {
    expect(ollamaSupportsVision('llama3.1')).toBe(false)
    expect(ollamaSupportsVision('mistral')).toBe(false)
    expect(ollamaSupportsVision('gemma3:1b')).toBe(false)
  })
})

describe('openAiCompatSupportsVision', () => {
  it('is permissive (cannot enumerate cloud models)', () => {
    expect(openAiCompatSupportsVision()).toBe(true)
  })
})
