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

examsRouter.get('/', zValidator('query', listExamsQuerySchema), (c) => {
  const { subjectId } = c.req.valid('query')
  return ok(c, z.array(examSchema), listExams(db, subjectId !== undefined ? { subjectId } : {}))
})

examsRouter.post('/', zValidator('json', createExamSchema), (c) =>
  ok(c, examSchema, createExam(db, c.req.valid('json')), 201),
)

examsRouter.get('/:id', zValidator('param', idParamSchema), (c) =>
  ok(c, examSchema, getExam(db, c.req.valid('param').id)),
)

examsRouter.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateExamSchema),
  (c) => ok(c, examSchema, updateExam(db, c.req.valid('param').id, c.req.valid('json'))),
)

examsRouter.delete('/:id', zValidator('param', idParamSchema), (c) => {
  deleteExam(db, c.req.valid('param').id)
  return c.body(null, 204)
})
