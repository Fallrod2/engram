import { describe, expect, it } from 'vitest'
import { OCR_INSTRUCTION, OCR_PROMPT_VERSION, OCR_SYSTEM_PROMPT } from './prompts/ocr.v1'

describe('ocr.v1 prompt', () => {
  it('is versioned ocr.v1', () => {
    expect(OCR_PROMPT_VERSION).toBe('ocr.v1')
  })

  it('system prompt covers the fidelity + uncertainty rules', () => {
    expect(OCR_SYSTEM_PROMPT.length).toBeGreaterThan(0)
    expect(OCR_SYSTEM_PROMPT).toContain('[?]')
    expect(OCR_SYSTEM_PROMPT).toContain('[illisible]')
    expect(OCR_SYSTEM_PROMPT).toMatch(/ne traduis (jamais|pas)/i)
    expect(OCR_SYSTEM_PROMPT).toMatch(/markdown/i)
  })

  it('instruction is non-empty and asks for a faithful transcription', () => {
    expect(OCR_INSTRUCTION.length).toBeGreaterThan(0)
    expect(OCR_INSTRUCTION).toMatch(/retranscris/i)
  })
})
