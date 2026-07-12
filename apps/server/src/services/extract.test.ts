import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectSourceType, extractText } from './extract'

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))),
  )
}

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-

describe('detectSourceType', () => {
  it('detects pdf via magic bytes even with a misleading extension', () => {
    expect(detectSourceType({ name: 'trick.md', type: '' }, PDF_MAGIC)).toBe('pdf')
  })

  it('detects pdf via the application/pdf MIME type', () => {
    expect(detectSourceType({ name: 'x', type: 'application/pdf' }, new Uint8Array())).toBe('pdf')
  })

  it('detects md via .md / .txt / .markdown', () => {
    const bytes = new Uint8Array([0x68, 0x69]) // "hi"
    expect(detectSourceType({ name: 'a.md', type: '' }, bytes)).toBe('md')
    expect(detectSourceType({ name: 'a.txt', type: '' }, bytes)).toBe('md')
    expect(detectSourceType({ name: 'a.markdown', type: '' }, bytes)).toBe('md')
  })

  it('detects md via a text MIME type', () => {
    expect(detectSourceType({ name: 'noext', type: 'text/markdown' }, new Uint8Array([1]))).toBe(
      'md',
    )
  })

  it('unknown type → null', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic
    expect(detectSourceType({ name: 'img.png', type: 'image/png' }, png)).toBeNull()
  })
})

describe('extractText', () => {
  it('MD decoded as UTF-8 with accents preserved', async () => {
    const text = await extractText(fixture('sample.md'), 'md')
    expect(text).toContain('déterministe')
    expect(text).toContain('éàçü')
  })

  it('PDF text extracted via unpdf (merged pages)', async () => {
    const text = await extractText(fixture('sample.pdf'), 'pdf')
    expect(text).toContain('Hello Engram PDF')
  })

  it('unreadable PDF → throws a clean error', async () => {
    const notPdf = new TextEncoder().encode('this is definitely not a pdf')
    await expect(extractText(notPdf, 'pdf')).rejects.toThrow(/could not read PDF/)
  })
})
