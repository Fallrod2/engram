import { Hono } from 'hono'
import { z } from 'zod'
import {
  createExamSchema,
  examSchema,
  idParamSchema,
  listExamsQuerySchema,
  updateExamSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { createExam, deleteExam, getExam, listExams, updateExam } from '../services/exams.service'

export const examsRouter = new Hono()

examsRouter.get('/', zValidator('query', listExamsQuerySchema), async (c) => {
  const { subjectId } = c.req.valid('query')
  return ok(
    c,
    z.array(examSchema),
    await listExams(db, subjectId !== undefined ? { subjectId } : {}),
  )
})

examsRouter.post('/', zValidator('json', createExamSchema), async (c) =>
  ok(c, examSchema, await createExam(db, c.req.valid('json')), 201),
)

examsRouter.get('/:id', zValidator('param', idParamSchema), async (c) =>
  ok(c, examSchema, await getExam(db, c.req.valid('param').id)),
)

examsRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateExamSchema),
  async (c) =>
    ok(c, examSchema, await updateExam(db, c.req.valid('param').id, c.req.valid('json'))),
)

examsRouter.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  await deleteExam(db, c.req.valid('param').id)
  return c.body(null, 204)
})
