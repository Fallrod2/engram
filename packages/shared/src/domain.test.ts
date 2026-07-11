import { describe, expect, it } from 'vitest'
import {
  colorHexSchema,
  createSubjectSchema,
  createCardSchema,
  reviewCardSchema,
  createNoteSchema,
  createExamSchema,
  updateDeckSchema,
} from './domain'

describe('colorHexSchema', () => {
  it('accepts #rrggbb', () => {
    expect(colorHexSchema.safeParse('#3B82F6').success).toBe(true)
    expect(colorHexSchema.safeParse('#000000').success).toBe(true)
  })
  it('rejects malformed colors', () => {
    for (const bad of ['3B82F6', '#fff', '#gggggg', '#3B82F6ff']) {
      expect(colorHexSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('createSubjectSchema', () => {
  it('accepts a valid payload, position optional', () => {
    expect(
      createSubjectSchema.safeParse({
        name: 'Anglais',
        color: '#10B981',
        icon: 'languages',
      }).success,
    ).toBe(true)
  })
  it('rejects an empty name and a bad color', () => {
    expect(createSubjectSchema.safeParse({ name: '', color: '#10B981', icon: 'x' }).success).toBe(
      false,
    )
    expect(createSubjectSchema.safeParse({ name: 'A', color: 'red', icon: 'x' }).success).toBe(
      false,
    )
  })
})

describe('createCardSchema', () => {
  it('does not accept FSRS fields from the client', () => {
    const parsed = createCardSchema.parse({
      deckId: 'd1',
      front: 'q',
      back: 'a',
      // extraneous FSRS-ish fields are stripped, not honored
      state: 2,
      due: '2026-01-01T00:00:00.000Z',
    })
    expect(parsed).toEqual({ deckId: 'd1', front: 'q', back: 'a' })
  })
})

describe('reviewCardSchema', () => {
  it('accepts grades 1..4 with optional duration/reviewedAt', () => {
    expect(reviewCardSchema.safeParse({ grade: 3 }).success).toBe(true)
    expect(
      reviewCardSchema.safeParse({
        grade: 1,
        durationMs: 1200,
        reviewedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })
  it('rejects grade 0 (Manual) and negative duration', () => {
    expect(reviewCardSchema.safeParse({ grade: 0 }).success).toBe(false)
    expect(reviewCardSchema.safeParse({ grade: 3, durationMs: -1 }).success).toBe(false)
  })
})

describe('createNoteSchema', () => {
  it('allows an uncategorized note (subjectId optional)', () => {
    expect(
      createNoteSchema.safeParse({
        title: 'N',
        sourceType: 'md',
        content: 'x',
      }).success,
    ).toBe(true)
  })
  it('rejects an unknown source type', () => {
    expect(
      createNoteSchema.safeParse({
        title: 'N',
        sourceType: 'docx',
        content: 'x',
      }).success,
    ).toBe(false)
  })
})

describe('createExamSchema', () => {
  it('requires at least one subject', () => {
    expect(
      createExamSchema.safeParse({
        title: 'Partiel',
        date: new Date().toISOString(),
        subjectIds: [],
      }).success,
    ).toBe(false)
    expect(
      createExamSchema.safeParse({
        title: 'Partiel',
        date: new Date().toISOString(),
        subjectIds: ['s1'],
      }).success,
    ).toBe(true)
  })
})

describe('updateDeckSchema', () => {
  it('never accepts subjectId', () => {
    const parsed = updateDeckSchema.parse({ name: 'New', subjectId: 's9' })
    expect(parsed).toEqual({ name: 'New' })
  })
})
