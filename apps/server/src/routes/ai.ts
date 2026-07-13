import { Hono } from 'hono'
import {
  aiSettingsResponseSchema,
  listModelsResponseSchema,
  providerParamSchema,
  setAiKeySchema,
  testConnectionRequestSchema,
  testConnectionResponseSchema,
  updateAiSettingsSchema,
} from '@engram/shared'
import { db } from '../db/client'
import { zValidator } from '../http/validate'
import { ok } from '../http/respond'
import { PROVIDERS } from '../ai/providers'
import {
  deleteAiKey,
  getAiSettings,
  resolveProviderForTest,
  setAiKey,
  updateAiSettings,
} from '../services/ai-config.service'

/**
 * `/api/ai` — multi-provider config surface. Mounted under `/api/*`, so the
 * shared auth gate applies (prerequisite for exposing key writes publicly). NO
 * response here ever carries a secret: keys are write-only (PUT/DELETE → 204),
 * status is read via GET /settings.
 */
export const aiRouter = new Hono()

// GET /api/ai/settings — config + per-provider status (never a secret).
aiRouter.get('/settings', async (c) => {
  return ok(c, aiSettingsResponseSchema, await getAiSettings(db))
})

// PATCH /api/ai/settings — active provider + model/baseUrl (secret fields stripped).
aiRouter.patch('/settings', zValidator('json', updateAiSettingsSchema), async (c) => {
  return ok(c, aiSettingsResponseSchema, await updateAiSettings(db, c.req.valid('json')))
})

// PUT /api/ai/providers/:provider/key — write-only upsert → 204.
aiRouter.put(
  '/providers/:provider/key',
  zValidator('param', providerParamSchema),
  zValidator('json', setAiKeySchema),
  async (c) => {
    await setAiKey(db, c.req.valid('param').provider, c.req.valid('json').key)
    return c.body(null, 204)
  },
)

// DELETE /api/ai/providers/:provider/key — remove; anthropic falls back to env → 204.
aiRouter.delete('/providers/:provider/key', zValidator('param', providerParamSchema), async (c) => {
  await deleteAiKey(db, c.req.valid('param').provider)
  return c.body(null, 204)
})

// POST /api/ai/providers/:provider/test — test stored config OR a candidate.
aiRouter.post(
  '/providers/:provider/test',
  zValidator('param', providerParamSchema),
  zValidator('json', testConnectionRequestSchema),
  async (c) => {
    const { provider } = c.req.valid('param')
    const cfg = await resolveProviderForTest(db, provider, c.req.valid('json'))
    if (!cfg) {
      return ok(c, testConnectionResponseSchema, {
        ok: false,
        detailCode: 'incomplete_config',
      })
    }
    const result = await PROVIDERS[provider].testConnection(cfg)
    return ok(c, testConnectionResponseSchema, result)
  },
)

// GET /api/ai/providers/:provider/models — selectable models (ollama/openrouter/…).
aiRouter.get('/providers/:provider/models', zValidator('param', providerParamSchema), async (c) => {
  const { provider } = c.req.valid('param')
  const adapter = PROVIDERS[provider]
  const cfg = await resolveProviderForTest(db, provider, {})
  if (!cfg || !adapter.listModels) {
    return ok(c, listModelsResponseSchema, { models: [] })
  }
  try {
    const models = await adapter.listModels(cfg)
    return ok(c, listModelsResponseSchema, { models })
  } catch {
    // Graceful degradation: an unreachable endpoint yields an empty list, not
    // a 500. The "Test connection" button surfaces the actual error detail.
    return ok(c, listModelsResponseSchema, { models: [] })
  }
})
