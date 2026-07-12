import { Hono } from 'hono'
import { z } from 'zod'
import {
  createSubjectSchema,
  idParamSchema,
  listSubjectsQuerySchema,
  subjectSchema,
  updateSubjectSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import {
  createSubject,
  deleteSubject,
  getSubject,
  listSubjects,
  setSubjectArchived,
  updateSubject,
} from '../services/subjects.service'

export const subjectsRouter = new Hono()

subjectsRouter.get('/', zValidator('query', listSubjectsQuerySchema), async (c) => {
  const { includeArchived } = c.req.valid('query')
  return ok(c, z.array(subjectSchema), await listSubjects(db, includeArchived ?? false))
})

subjectsRouter.post('/', zValidator('json', createSubjectSchema), async (c) => {
  return ok(c, subjectSchema, await createSubject(db, c.req.valid('json')), 201)
})

subjectsRouter.get('/:id', zValidator('param', idParamSchema), async (c) => {
  return ok(c, subjectSchema, await getSubject(db, c.req.valid('param').id))
})

subjectsRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateSubjectSchema),
  async (c) => {
    return ok(
      c,
      subjectSchema,
      await updateSubject(db, c.req.valid('param').id, c.req.valid('json')),
    )
  },
)

subjectsRouter.post('/:id/archive', zValidator('param', idParamSchema), async (c) => {
  return ok(c, subjectSchema, await setSubjectArchived(db, c.req.valid('param').id, true))
})

subjectsRouter.post('/:id/unarchive', zValidator('param', idParamSchema), async (c) => {
  return ok(c, subjectSchema, await setSubjectArchived(db, c.req.valid('param').id, false))
})

subjectsRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteSubject(db, c.req.valid('param').id)
  return c.body(null, 204)
})
