import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectImageMedia, detectSourceType, extractText } from './extract'

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

describe('detectImageMedia', () => {
  const meta = { name: 'x', type: '' }

  it('detects JPEG via magic bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(detectImageMedia(meta, jpeg)).toEqual({ mediaType: 'image/jpeg' })
  })

  it('detects PNG via the 8-byte signature', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(detectImageMedia(meta, png)).toEqual({ mediaType: 'image/png' })
  })

  it('detects WebP via RIFF…WEBP', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(detectImageMedia(meta, webp)).toEqual({ mediaType: 'image/webp' })
  })

  it('flags HEIC (ftyp + heic brand) for targeted rejection', () => {
    // 4 bytes box size, "ftyp" @ 4, "heic" brand @ 8.
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ])
    expect(detectImageMedia(meta, heic)).toEqual({ heic: true })
  })

  it('flags a mif1-brand HEIF container too', () => {
    const heif = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31,
    ])
    expect(detectImageMedia(meta, heif)).toEqual({ heic: true })
  })

  it('bytes win over a misleading extension (jpeg bytes named .png)', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb])
    expect(detectImageMedia({ name: 'trick.png', type: 'image/png' }, jpeg)).toEqual({
      mediaType: 'image/jpeg',
    })
  })

  it('text / pdf / gif bytes → null', () => {
    expect(detectImageMedia(meta, new Uint8Array([0x68, 0x69]))).toBeNull() // "hi"
    expect(detectImageMedia(meta, new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull() // %PDF
    // GIF89a — deliberately unsupported (spec §1.1).
    expect(detectImageMedia(meta, new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull()
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
