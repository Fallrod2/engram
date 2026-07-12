import { describe, expect, it } from 'vitest'
import { chunkNote, MAX_CHUNK_CHARS, MAX_CHUNKS } from './chunk'

describe('chunkNote', () => {
  it('short text → a single trimmed chunk', () => {
    const chunks = chunkNote('  hello world  ')
    expect(chunks).toEqual(['hello world'])
  })

  it('splits on a blank line, never mid-paragraph', () => {
    const a = 'A'.repeat(8000)
    const b = 'B'.repeat(8000)
    const chunks = chunkNote(`${a}\n\n${b}`)
    expect(chunks).toEqual([a, b])
  })

  it('a single paragraph longer than maxChars is hard-split into slices', () => {
    const chunks = chunkNote('x'.repeat(25), 10)
    expect(chunks).toEqual(['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx'])
  })

  it('respects MAX_CHUNKS (hard cap)', () => {
    // Each paragraph is exactly 9 chars (fits under maxChars=10 alone), but two
    // together (9 + 2 + 9) exceed it → one paragraph per chunk.
    const paras = Array.from({ length: MAX_CHUNKS + 10 }, (_, i) => `p${i}`.padEnd(9, '.'))
    const chunks = chunkNote(paras.join('\n\n'), 10)
    expect(chunks.length).toBe(MAX_CHUNKS)
  })

  it('empty string → a single empty chunk (never empty array)', () => {
    expect(chunkNote('')).toEqual([''])
    expect(chunkNote('   \n\n  ')).toEqual([''])
  })

  it('default budget is MAX_CHUNK_CHARS', () => {
    expect(chunkNote('a'.repeat(MAX_CHUNK_CHARS))).toHaveLength(1)
    expect(chunkNote('a'.repeat(MAX_CHUNK_CHARS + 1))).toHaveLength(2)
  })
})
