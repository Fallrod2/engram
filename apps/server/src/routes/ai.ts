import { Hono } from 'hono'
import {
  aiSettingsResponseSchema,
  codexLinkPollRequestSchema,
  codexLinkPollResponseSchema,
  codexLinkStartResponseSchema,
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
import { ServiceUnavailableError, UpstreamError } from '../http/errors'
import { requireUserId, requireNotDemo } from '../http/identity'
import { PROVIDERS } from '../ai/providers'
import {
  deleteAiKey,
  getAiSettings,
  resolveCodexConfig,
  resolveProviderForTest,
  setAiKey,
  setOauthCredential,
  updateAiSettings,
} from '../services/ai-config.service'
import {
  DeviceAuthDisabledError,
  DeviceAuthUpstreamError,
  pollDeviceAuth,
  startDeviceAuth,
} from '../ai/providers/codex-oauth'
import { openHandle, sealHandle } from '../ai/providers/codex-handle'
import {
  CODEX_DEVICE_EXPIRES_IN_SECONDS,
  CODEX_VERIFICATION_URI,
} from '../ai/providers/codex-constants'

/**
 * `/api/ai` — multi-provider config surface, now PER USER (spec BYOK §1.3).
 * Mounted under `/api/*`, so the shared auth gate applies. NO response here ever
 * carries a secret: keys are write-only (PUT/DELETE → 204), status is read via
 * GET /settings.
 *
 * Every route is scoped to the caller (`requireUserId`): each user brings their
 * own key (BYOK) and sees only their own config. The env fallback (Alex's
 * `ANTHROPIC_API_KEY`) is admin-only in the service, so a public signup never
 * consumes it. The demo account may READ generation/OCR via the admin alias; its
 * TEST/models calls run against its OWN config (NOT aliased — audit fix, so the
 * admin's key can't be exfiltrated to a demo-supplied baseUrl), and
 * `requireNotDemo` blocks it from WRITING config (its data is wiped each login).
 */
export const aiRouter = new Hono()

// GET /api/ai/settings — config + per-provider status (never a secret), scoped.
aiRouter.get('/settings', async (c) => {
  return ok(c, aiSettingsResponseSchema, await getAiSettings(db, requireUserId(c)))
})

// PATCH /api/ai/settings — active provider + model/baseUrl (secret fields stripped).
aiRouter.patch('/settings', zValidator('json', updateAiSettingsSchema), async (c) => {
  return ok(
    c,
    aiSettingsResponseSchema,
    await updateAiSettings(db, requireNotDemo(c), c.req.valid('json')),
  )
})

// --- openai-codex device-code link flow -----------------------------------
//
// Writes only (requireNotDemo — the demo can never link a subscription). Guarded
// by the kill-switch: a disabled instance 503s honestly. NO token is ever sent
// to the client; the handle is an opaque, user-bound HMAC blob (Vercel-safe).

/** Guard: refuse the whole link surface when the provider is off (spec §3). */
function assertCodexEnabled(): void {
  if (!resolveCodexConfig(process.env).enabled) {
    throw new ServiceUnavailableError('openai-codex is disabled on this instance')
  }
}

// POST /api/ai/providers/openai-codex/link/start — begin device-code auth.
aiRouter.post('/providers/openai-codex/link/start', async (c) => {
  assertCodexEnabled()
  const userId = requireNotDemo(c)
  try {
    const start = await startDeviceAuth()
    const handle = sealHandle({
      deviceAuthId: start.deviceAuthId,
      userCode: start.userCode,
      userId,
    })
    return ok(c, codexLinkStartResponseSchema, {
      userCode: start.userCode,
      verificationUri: CODEX_VERIFICATION_URI,
      expiresIn: CODEX_DEVICE_EXPIRES_IN_SECONDS,
      handle,
    })
  } catch (e) {
    if (e instanceof DeviceAuthDisabledError) {
      // 503 service_unavailable → the front's reliable "enable the toggle" message.
      throw new ServiceUnavailableError(
        'device code login is disabled on this ChatGPT account (enable it in Settings → Security)',
      )
    }
    if (e instanceof DeviceAuthUpstreamError) {
      // 502 upstream_error → OpenAI refused/failed the initiation; report it
      // honestly (upstream status in the message + details) instead of blaming
      // the account. The front shows a "try again later" message, not "disabled".
      throw new UpstreamError(`OpenAI refused the device-code initiation (HTTP ${e.httpStatus})`, {
        upstreamStatus: e.httpStatus,
      })
    }
    throw e
  }
})

// POST /api/ai/providers/openai-codex/link/poll — poll + exchange server-side.
aiRouter.post(
  '/providers/openai-codex/link/poll',
  zValidator('json', codexLinkPollRequestSchema),
  async (c) => {
    assertCodexEnabled()
    const userId = requireNotDemo(c)
    const opened = openHandle(c.req.valid('json').handle, userId)
    // Invalid/expired/other-user handle → treat as expired (restart the flow).
    if (!opened) return ok(c, codexLinkPollResponseSchema, { status: 'expired' })

    const poll = await pollDeviceAuth(opened)
    if (poll.status === 'pending') return ok(c, codexLinkPollResponseSchema, { status: 'pending' })
    if (poll.status === 'denied') return ok(c, codexLinkPollResponseSchema, { status: 'denied' })

    // Linked: persist the tokens (write-only) and report success.
    await setOauthCredential(db, userId, 'openai-codex', poll.tokens)
    return ok(c, codexLinkPollResponseSchema, { status: 'linked' })
  },
)

// DELETE /api/ai/providers/openai-codex/link — unlink (remove the credential).
aiRouter.delete('/providers/openai-codex/link', async (c) => {
  await deleteAiKey(db, requireNotDemo(c), 'openai-codex')
  return c.body(null, 204)
})

// PUT /api/ai/providers/:provider/key — write-only upsert → 204.
aiRouter.put(
  '/providers/:provider/key',
  zValidator('param', providerParamSchema),
  zValidator('json', setAiKeySchema),
  async (c) => {
    await setAiKey(db, requireNotDemo(c), c.req.valid('param').provider, c.req.valid('json').key)
    return c.body(null, 204)
  },
)

// DELETE /api/ai/providers/:provider/key — remove; anthropic falls back to env → 204.
aiRouter.delete('/providers/:provider/key', zValidator('param', providerParamSchema), async (c) => {
  await deleteAiKey(db, requireNotDemo(c), c.req.valid('param').provider)
  return c.body(null, 204)
})

// POST /api/ai/providers/:provider/test — test stored config OR a candidate.
aiRouter.post(
  '/providers/:provider/test',
  zValidator('param', providerParamSchema),
  zValidator('json', testConnectionRequestSchema),
  async (c) => {
    const { provider } = c.req.valid('param')
    const adapter = PROVIDERS[provider]
    const cfg = await resolveProviderForTest(db, requireUserId(c), provider, c.req.valid('json'))
    // The env fallback is admin-only (spec BYOK §1.2): a key-requiring provider
    // with NO resolved key (`keySource === null`) must never reach the adapter.
    // For anthropic, `clientFor` would otherwise pass `undefined` and the SDK's
    // `new Anthropic()` would read the admin's `ANTHROPIC_API_KEY` from
    // process.env — leaking a validity oracle + the admin account's model list
    // to a public (BYOK) caller. Short-circuit to `incomplete_config` first.
    // `cfg === null` means the model (or, for ollama/openai-compat, the base URL)
    // is missing → genuine `incomplete_config`. A resolved config that still has
    // no key for a key-requiring provider is a DISTINCT case: the model/URL are
    // fine, only the key is missing → `missing_key` (so the guided flow points at
    // the right field instead of sending the user in circles, audit fix).
    if (!cfg) {
      return ok(c, testConnectionResponseSchema, { ok: false, detailCode: 'incomplete_config' })
    }
    if (adapter.requiresKey && cfg.keySource === null) {
      return ok(c, testConnectionResponseSchema, { ok: false, detailCode: 'missing_key' })
    }
    const result = await adapter.testConnection(cfg)
    return ok(c, testConnectionResponseSchema, result)
  },
)

// GET /api/ai/providers/:provider/models — selectable models (ollama/openrouter/…).
aiRouter.get('/providers/:provider/models', zValidator('param', providerParamSchema), async (c) => {
  const { provider } = c.req.valid('param')
  const adapter = PROVIDERS[provider]
  const cfg = await resolveProviderForTest(db, requireUserId(c), provider, {})
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
