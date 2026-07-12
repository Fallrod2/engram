import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'bun:test'
import { noteSchema, listNotesResponseSchema } from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { generation, note } from '../db/schema'
import { resetDb, seedSubject } from '../test-support/harness'

beforeEach(() => resetDb(db))

const pdfBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../services/__fixtures__/sample.pdf', import.meta.url))),
)

function upload(file: File, fields: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return app.request('/api/notes/upload', { method: 'POST', body: fd })
}

const postJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const patchJson = (path: string, body: unknown) =>
  app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('notes upload', () => {
  it('POST /upload (md) → 201, extracted, sourceType md, derived title + filename', async () => {
    const res = await upload(
      new File(['# Cours\n\nContenu éàç.'], 'lecture.md', { type: 'text/markdown' }),
    )
    expect(res.status).toBe(201)
    const n = noteSchema.parse(await res.json())
    expect(n.sourceType).toBe('md')
    expect(n.originalFilename).toBe('lecture.md')
    expect(n.title).toBe('lecture')
    expect(n.content).toContain('Contenu éàç.')
  })

  it('POST /upload (pdf) → 201, text extracted', async () => {
    const res = await upload(new File([pdfBytes], 'doc.pdf', { type: 'application/pdf' }))
    expect(res.status).toBe(201)
    const n = noteSchema.parse(await res.json())
    expect(n.sourceType).toBe('pdf')
    expect(n.content).toContain('Hello Engram PDF')
  })

  it('POST /upload without a file → 400', async () => {
    const res = await app.request('/api/notes/upload', { method: 'POST', body: new FormData() })
    expect(res.status).toBe(400)
  })

  it('POST /upload file > 10 MiB → 413 (payload_too_large)', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.md', {
      type: 'text/markdown',
    })
    const res = await upload(big)
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('payload_too_large')
  })

  it('POST /upload unsupported type (.png) → 400', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'img.png', {
      type: 'image/png',
    })
    expect((await upload(png)).status).toBe(400)
  })

  it('POST /upload empty MD → 400 no extractable text', async () => {
    const res = await upload(new File(['   \n  '], 'empty.md', { type: 'text/markdown' }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('no extractable text')
  })

  it('POST /upload subjectId archived → 409 ; unknown → 404', async () => {
    const archived = await seedSubject(db, { archived: true })
    const mk = () => new File(['# ok\n\ntext'], 'a.md', { type: 'text/markdown' })
    expect((await upload(mk(), { subjectId: archived.id })).status).toBe(409)
    expect((await upload(mk(), { subjectId: 'nope' })).status).toBe(404)
  })
})

describe('notes CRUD', () => {
  it('POST /api/notes (JSON pasted text) → 201', async () => {
    const res = await postJson('/api/notes', {
      title: 'Collé',
      sourceType: 'md',
      content: '# Titre\n\ndu texte',
    })
    expect(res.status).toBe(201)
    const n = noteSchema.parse(await res.json())
    expect(n.content).toContain('du texte')
  })

  it('POST /api/notes with blank content → 400 note content is empty', async () => {
    const res = await postJson('/api/notes', { title: 'x', sourceType: 'md', content: '   ' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('note content is empty')
  })

  it('GET /api/notes filters by subjectId ; GET /:id 404', async () => {
    const s = await seedSubject(db)
    await postJson('/api/notes', { subjectId: s.id, title: 'a', sourceType: 'md', content: 'aaa' })
    await postJson('/api/notes', { title: 'b', sourceType: 'md', content: 'bbb' })
    const all = listNotesResponseSchema.parse(await (await app.request('/api/notes')).json())
    expect(all.notes).toHaveLength(2)
    const filtered = listNotesResponseSchema.parse(
      await (await app.request(`/api/notes?subjectId=${s.id}`)).json(),
    )
    expect(filtered.notes).toHaveLength(1)
    expect(filtered.notes[0]?.subjectId).toBe(s.id)
    expect((await app.request('/api/notes/nope')).status).toBe(404)
  })

  it('PATCH /api/notes/:id attaches a subject ; empty body is a no-op', async () => {
    const created = noteSchema.parse(
      await (await postJson('/api/notes', { title: 'n', sourceType: 'md', content: 'ccc' })).json(),
    )
    const s = await seedSubject(db)
    const patched = noteSchema.parse(
      await (await patchJson(`/api/notes/${created.id}`, { subjectId: s.id })).json(),
    )
    expect(patched.subjectId).toBe(s.id)
    const noop = noteSchema.parse(await (await patchJson(`/api/notes/${created.id}`, {})).json())
    expect(noop.subjectId).toBe(s.id)
  })

  it('DELETE /api/notes/:id → 204 and cascades linked generations', async () => {
    const created = noteSchema.parse(
      await (await postJson('/api/notes', { title: 'n', sourceType: 'md', content: 'ddd' })).json(),
    )
    await db
      .insert(generation)
      .values({ noteId: created.id, kind: 'cards', model: 'claude-sonnet-4-6', status: 'pending' })
    expect(await db.select().from(generation)).toHaveLength(1)
    expect((await app.request(`/api/notes/${created.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await db.select().from(note)).toHaveLength(0)
    expect(await db.select().from(generation)).toHaveLength(0)
  })
})
