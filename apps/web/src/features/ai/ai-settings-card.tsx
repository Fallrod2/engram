import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, RotateCw, X } from 'lucide-react'
import type {
  AiOcrSettings,
  AiProviderId,
  AiProviderStatus,
  AiSettings,
  CodexLinkStartResponse,
  TestConnectionResponse,
  UpdateAiSettings,
} from '@engram/shared'
import { ApiError } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { useT, type TFunction } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  aiSettingsOptions,
  pollCodexLink,
  useDeleteAiKey,
  useProviderModels,
  useSetAiKey,
  useStartCodexLink,
  useTestConnection,
  useUnlinkCodex,
  useUpdateAiSettings,
} from './queries'

const PROVIDER_ORDER: AiProviderId[] = [
  'anthropic',
  'openrouter',
  'ollama',
  'openai-compat',
  'mistral',
  'openai-codex',
]

/**
 * Providers offered in the OCR provider Select. openai-codex is EXCLUDED (audit
 * C14): it has no vision transport, so an OCR slot pointed at it would only 503.
 */
const OCR_PROVIDER_ORDER: AiProviderId[] = PROVIDER_ORDER.filter((p) => p !== 'openai-codex')

/** Free-entry presets (datalist suggestions), per provider. */
const MODEL_PRESETS: Record<AiProviderId, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
  openrouter: [
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.1-8b-instruct',
  ],
  ollama: [],
  'openai-compat': [],
  mistral: ['mistral-small-latest', 'mistral-large-latest', 'pixtral-large-latest'],
  'openai-codex': ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
}

/**
 * Presets for the dedicated OCR slot (datalist), per provider. Mistral leads
 * with its dedicated OCR model; the others reuse their vision-capable models.
 * openai-codex has no vision → empty (kept for the exhaustive Record).
 */
const OCR_MODEL_PRESETS: Record<AiProviderId, string[]> = {
  mistral: ['mistral-ocr-latest', 'pixtral-large-latest'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  openrouter: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
  ollama: [],
  'openai-compat': [],
  'openai-codex': [],
}

/** First sensible OCR model for a provider (used when switching OCR provider). */
function defaultOcrModel(p: AiProviderId): string {
  return OCR_MODEL_PRESETS[p][0] ?? ''
}

/** Map the server's i18n-neutral test outcome code to a localized message. */
function testDetailMessage(t: TFunction, res: TestConnectionResponse): string {
  const base = t(`settings.ai.testDetail.${res.detailCode}`)
  return res.httpStatus ? `${base} (HTTP ${res.httpStatus})` : base
}

function providerLabel(t: TFunction, p: AiProviderId): string {
  switch (p) {
    case 'anthropic':
      return t('settings.ai.providerAnthropic')
    case 'openrouter':
      return t('settings.ai.providerOpenrouter')
    case 'ollama':
      return t('settings.ai.providerOllama')
    case 'openai-compat':
      return t('settings.ai.providerOpenaiCompat')
    case 'mistral':
      return t('settings.ai.providerMistral')
    case 'openai-codex':
      return t('settings.ai.providerCodex')
  }
}

/** Section: the AI provider config surface (spec §6.1). */
export function AiSettingsCard() {
  const t = useT()
  const settingsQ = useQuery(aiSettingsOptions())

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.ai.title')}</CardTitle>
        <CardDescription>{t('settings.ai.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {settingsQ.data ? (
          <>
            <AiSettingsBody settings={settingsQ.data.settings} statuses={settingsQ.data.statuses} />
            <Separator />
            <OcrSettingsSection
              settings={settingsQ.data.settings}
              statuses={settingsQ.data.statuses}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AiSettingsBody({
  settings,
  statuses,
}: {
  settings: AiSettings
  statuses: AiProviderStatus[]
}) {
  const t = useT()
  const active = settings.activeProvider
  const providerConfig = settings.providers[active]
  const status = statuses.find((s) => s.provider === active)

  const updateSettings = useUpdateAiSettings()
  const setKey = useSetAiKey()
  const deleteKey = useDeleteAiKey()
  const testConn = useTestConnection()

  const isCodex = active === 'openai-codex'
  const requiresKey = active !== 'ollama' && !isCodex
  const hasBaseUrl = active === 'ollama' || active === 'openai-compat'
  const isOllama = active === 'ollama'

  // Editable local copies of the non-secret config, synced when the active
  // provider or its stored config changes. The key field is NEVER pre-filled.
  const [model, setModel] = useState(providerConfig.model)
  const [baseUrl, setBaseUrl] = useState(providerConfig.baseUrl ?? '')
  const [keyInput, setKeyInput] = useState('')
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null)

  useEffect(() => {
    setModel(providerConfig.model)
    setBaseUrl(providerConfig.baseUrl ?? '')
    setKeyInput('')
    setTestResult(null)
  }, [active, providerConfig.model, providerConfig.baseUrl])

  const modelsQ = useProviderModels(active, isOllama)
  // Keep the server-provided label (e.g. 'gemma3:12b · 12.2B') alongside the id;
  // the current model is always kept as an option even if not in the fetched list.
  const modelOptions = useMemo(() => {
    const list = modelsQ.data?.models ?? []
    const ids = [...new Set([...(model ? [model] : []), ...list.map((m) => m.id)])]
    const labelById = new Map(list.map((m) => [m.id, m.label]))
    return ids.map((id) => ({ id, label: labelById.get(id) ?? id }))
  }, [model, modelsQ.data])

  function changeProvider(next: AiProviderId) {
    updateSettings.mutate({ activeProvider: next })
  }

  function saveConfig() {
    // Computed-key patch for the active provider (cast: `active` is a valid id).
    const providers = {
      [active]: { model, ...(hasBaseUrl ? { baseUrl } : {}) },
    } as UpdateAiSettings['providers']
    updateSettings.mutate(
      { providers },
      {
        onSuccess: () => toast.success(t('settings.ai.saved')),
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'forbidden'
              ? t('settings.adminOnly')
              : t('settings.ai.saveError'),
          ),
      },
    )
  }

  function saveKey() {
    if (keyInput.trim().length === 0) return
    setKey.mutate(
      { provider: active, key: keyInput.trim() },
      {
        onSuccess: () => {
          setKeyInput('')
          toast.success(t('settings.ai.keySaved'))
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'forbidden'
              ? t('settings.adminOnly')
              : t('settings.ai.saveError'),
          ),
      },
    )
  }

  function removeKey() {
    deleteKey.mutate(active, { onSuccess: () => toast.success(t('settings.ai.keyDeleted')) })
  }

  function runTest() {
    setTestResult(null)
    testConn.mutate(
      {
        provider: active,
        candidate: {
          ...(keyInput.trim() ? { key: keyInput.trim() } : {}),
          ...(hasBaseUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      },
      {
        onSuccess: (res) => {
          setTestResult(res)
          if (isOllama) void modelsQ.refetch()
        },
        onError: () => setTestResult({ ok: false, detailCode: 'unreachable' }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Active provider */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="ai-provider">{t('settings.ai.provider')}</Label>
        <Select value={active} onValueChange={(v) => changeProvider(v as AiProviderId)}>
          <SelectTrigger id="ai-provider" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_ORDER.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="flex items-center gap-2">
                  {providerLabel(t, p)}
                  {p === 'ollama' && <Badge variant="success">{t('settings.ai.localBadge')}</Badge>}
                  {p === 'openai-codex' && (
                    <Badge variant="warning">{t('settings.ai.experimentalBadge')}</Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Base URL (ollama / openai-compat) */}
      {hasBaseUrl && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-baseurl">{t('settings.ai.baseUrl')}</Label>
          <Input
            id="ai-baseurl"
            value={baseUrl}
            placeholder={t('settings.ai.baseUrlPlaceholder')}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      )}

      {/* Model */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ai-model">{t('settings.ai.model')}</Label>
          {isOllama && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void modelsQ.refetch()}
              disabled={modelsQ.isFetching}
            >
              <RotateCw className="size-3.5" aria-hidden />
              {t('settings.ai.refresh')}
            </Button>
          )}
        </div>
        {isOllama && modelOptions.length > 0 ? (
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="ai-model">
              <SelectValue placeholder={t('settings.ai.modelPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Input
              id="ai-model"
              value={model}
              list={`ai-model-presets-${active}`}
              placeholder={t('settings.ai.modelPlaceholder')}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id={`ai-model-presets-${active}`}>
              {MODEL_PRESETS[active].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {isOllama && <p className="text-xs text-text-muted">{t('settings.ai.noModels')}</p>}
          </>
        )}
      </div>

      {/* openai-codex: OAuth link flow instead of an API key */}
      {isCodex && status && <CodexLinkSection status={status} />}

      {/* API key — write-only */}
      {requiresKey && status && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="ai-key">{t('settings.ai.apiKey')}</Label>
            <KeyStatusBadge status={status} />
          </div>
          <div className="flex items-center gap-2">
            <Input
              id="ai-key"
              type="password"
              value={keyInput}
              autoComplete="off"
              placeholder={status.hasKey ? '••••••••' : t('settings.ai.apiKeyPlaceholder')}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={saveKey}
              disabled={keyInput.trim().length === 0 || setKey.isPending}
            >
              {t('settings.ai.save')}
            </Button>
            {status.hasKey && status.keySource === 'app' && (
              <Button variant="outline" onClick={removeKey} disabled={deleteKey.isPending}>
                {t('settings.ai.deleteKey')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Actions: test + save config */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runTest} disabled={testConn.isPending}>
          {testConn.isPending ? t('settings.ai.testing') : t('settings.ai.test')}
        </Button>
        <Button onClick={saveConfig} disabled={updateSettings.isPending}>
          {t('settings.ai.save')}
        </Button>
        {testResult && (
          <span
            className={`flex items-center gap-1.5 text-xs ${
              testResult.ok ? 'text-success' : 'text-danger'
            }`}
          >
            {testResult.ok ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <X className="size-3.5" aria-hidden />
            )}
            {testDetailMessage(t, testResult)}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-text-muted">
        {isCodex ? t('settings.ai.codexHint') : t('settings.ai.claudeHint')}
      </p>
    </div>
  )
}

/**
 * openai-codex OAuth link surface (spec §4.3). Replaces the API key field for the
 * subscription provider. Three states:
 * - unavailable (kill-switch off): honest "unavailable on this instance".
 * - linked: "Compte lié" badge + Délier.
 * - not linked: "Lier mon compte ChatGPT" → shows the user code + verification
 *   link + auto-polls until linked/expired. NO token ever reaches the client.
 */
function CodexLinkSection({ status }: { status: AiProviderStatus }) {
  const t = useT()
  const qc = useQueryClient()
  const startLink = useStartCodexLink()
  const unlink = useUnlinkCodex()
  const [session, setSession] = useState<CodexLinkStartResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-poll while a link session is active; stops on any terminal status.
  // `refetchIntervalInBackground` is REQUIRED here: the user switches to the
  // ChatGPT tab to authorize, which backgrounds engram's tab — without this the
  // interval would freeze and the link would never complete.
  const pollQ = useQuery({
    queryKey: ['codex-link-poll', session?.handle],
    queryFn: () => pollCodexLink(session!.handle),
    enabled: session !== null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 4000),
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    const s = pollQ.data?.status
    if (!s || s === 'pending') return
    if (s === 'linked') {
      setSession(null)
      toast.success(t('settings.ai.codex.linked'))
      void qc.invalidateQueries({ queryKey: qk.ai.settings })
      return
    }
    // expired / denied / device_auth_disabled → surface a message, allow retry.
    setSession(null)
    setError(t(`settings.ai.codex.status.${s}`))
  }, [pollQ.data, qc, t])

  function startFlow() {
    setError(null)
    startLink.mutate(undefined, {
      onSuccess: (data) => setSession(data),
      onError: (err) =>
        setError(
          err instanceof ApiError && err.code === 'service_unavailable'
            ? t('settings.ai.codex.status.device_auth_disabled')
            : t('settings.ai.codex.startError'),
        ),
    })
  }

  if (status.unavailable) {
    return (
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-text-muted">
          {t('settings.ai.codex.unavailable')}
        </p>
      </div>
    )
  }

  if (status.linked) {
    return (
      <div className="flex items-center justify-between gap-3">
        <Badge variant="success">{t('settings.ai.codex.linkedBadge')}</Badge>
        <Button variant="outline" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
          {t('settings.ai.codex.unlink')}
        </Button>
      </div>
    )
  }

  if (session) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-3 py-3">
        <p className="text-xs leading-relaxed text-text-muted">
          {t('settings.ai.codex.instructions')}
        </p>
        <div className="flex items-center gap-3">
          <code className="rounded bg-surface px-2 py-1 font-mono text-sm tracking-widest text-text">
            {session.userCode}
          </code>
          <a
            href={session.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-primary underline"
          >
            {t('settings.ai.codex.openPage')}
          </a>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <RotateCw className="size-3 animate-spin" aria-hidden />
          {t('settings.ai.codex.waiting')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="secondary" onClick={startFlow} disabled={startLink.isPending}>
        {t('settings.ai.codex.link')}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function KeyStatusBadge({ status }: { status: AiProviderStatus }) {
  const t = useT()
  if (status.keySource === 'app') {
    return <Badge variant="success">{t('settings.ai.statusConfigured')}</Badge>
  }
  if (status.keySource === 'env') {
    return <Badge variant="info">{t('settings.ai.statusConfiguredEnv')}</Badge>
  }
  return <Badge variant="warning">{t('settings.ai.statusNotConfigured')}</Badge>
}

/**
 * OCR / photo-import sub-section: lets the OCR path use a DIFFERENT provider +
 * model than card generation (spec §4.2). Exported for direct unit testing (the
 * whole `./queries` layer is mocked in the test). The API key + base URL stay
 * per-provider (shared with generation), so this reuses the existing key/test
 * mutations — no new endpoint.
 */
export function OcrSettingsSection({
  settings,
  statuses,
}: {
  settings: AiSettings
  statuses: AiProviderStatus[]
}) {
  const t = useT()
  const ocr = settings.ocr
  const mode = ocr.mode
  const ocrProvider = ocr.provider
  const status = statuses.find((s) => s.provider === ocrProvider)

  const updateSettings = useUpdateAiSettings()
  const setKey = useSetAiKey()
  const deleteKey = useDeleteAiKey()
  const testConn = useTestConnection()

  const requiresKey = ocrProvider !== 'ollama'
  const isOllama = ocrProvider === 'ollama'

  // Editable OCR model, resynced when the mode/provider/stored model changes.
  const [model, setModel] = useState(ocr.model)
  const [keyInput, setKeyInput] = useState('')
  const [testResult, setTestResult] = useState<TestConnectionResponse | null>(null)

  useEffect(() => {
    setModel(ocr.model)
    setKeyInput('')
    setTestResult(null)
  }, [mode, ocrProvider, ocr.model])

  const modelsQ = useProviderModels(ocrProvider, mode === 'custom' && isOllama)
  const modelOptions = useMemo(() => {
    const list = modelsQ.data?.models ?? []
    const ids = [...new Set([...(model ? [model] : []), ...list.map((m) => m.id)])]
    const labelById = new Map(list.map((m) => [m.id, m.label]))
    return ids.map((id) => ({ id, label: labelById.get(id) ?? id }))
  }, [model, modelsQ.data])

  function changeMode(next: AiOcrSettings['mode']) {
    updateSettings.mutate({ ocr: { mode: next } })
  }

  function changeProvider(next: AiProviderId) {
    // Switching provider also seeds a sensible default OCR model for it.
    updateSettings.mutate({ ocr: { provider: next, model: defaultOcrModel(next) } })
  }

  function saveModel() {
    updateSettings.mutate(
      { ocr: { model } },
      {
        onSuccess: () => toast.success(t('settings.ai.saved')),
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'forbidden'
              ? t('settings.adminOnly')
              : t('settings.ai.saveError'),
          ),
      },
    )
  }

  function saveKey() {
    if (keyInput.trim().length === 0) return
    setKey.mutate(
      { provider: ocrProvider, key: keyInput.trim() },
      {
        onSuccess: () => {
          setKeyInput('')
          toast.success(t('settings.ai.keySaved'))
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'forbidden'
              ? t('settings.adminOnly')
              : t('settings.ai.saveError'),
          ),
      },
    )
  }

  function removeKey() {
    deleteKey.mutate(ocrProvider, { onSuccess: () => toast.success(t('settings.ai.keyDeleted')) })
  }

  function runTest() {
    setTestResult(null)
    testConn.mutate(
      {
        provider: ocrProvider,
        candidate: {
          ...(keyInput.trim() ? { key: keyInput.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        },
      },
      {
        onSuccess: (res) => {
          setTestResult(res)
          if (isOllama) void modelsQ.refetch()
        },
        onError: () => setTestResult({ ok: false, detailCode: 'unreachable' }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {/* Non-heading (like CardTitle, a div) to keep the page's heading order
            intact — the page exposes only the h1 in its PageHeader. */}
        <p className="text-sm font-medium text-text">{t('settings.ai.ocr.title')}</p>
        <p className="text-xs leading-relaxed text-text-muted">{t('settings.ai.ocr.desc')}</p>
      </div>

      {/* Mode: same as generation (default) ↔ dedicated OCR provider */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="ocr-mode">{t('settings.ai.ocr.mode')}</Label>
        <Select value={mode} onValueChange={(v) => changeMode(v as AiOcrSettings['mode'])}>
          <SelectTrigger id="ocr-mode" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="same">{t('settings.ai.ocr.modeSame')}</SelectItem>
            <SelectItem value="custom">{t('settings.ai.ocr.modeCustom')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === 'custom' && (
        <>
          {/* Dedicated OCR provider */}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="ocr-provider">{t('settings.ai.ocr.provider')}</Label>
            <Select value={ocrProvider} onValueChange={(v) => changeProvider(v as AiProviderId)}>
              <SelectTrigger id="ocr-provider" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OCR_PROVIDER_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      {providerLabel(t, p)}
                      {p === 'ollama' && (
                        <Badge variant="success">{t('settings.ai.localBadge')}</Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dedicated OCR model */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="ocr-model">{t('settings.ai.ocr.model')}</Label>
              {isOllama && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void modelsQ.refetch()}
                  disabled={modelsQ.isFetching}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                  {t('settings.ai.refresh')}
                </Button>
              )}
            </div>
            {isOllama && modelOptions.length > 0 ? (
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="ocr-model">
                  <SelectValue placeholder={t('settings.ai.modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input
                  id="ocr-model"
                  value={model}
                  list={`ocr-model-presets-${ocrProvider}`}
                  placeholder={t('settings.ai.modelPlaceholder')}
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id={`ocr-model-presets-${ocrProvider}`}>
                  {OCR_MODEL_PRESETS[ocrProvider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
          </div>

          {/* API key — shared with generation for this provider (write-only) */}
          {requiresKey && status && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="ocr-key">{t('settings.ai.apiKey')}</Label>
                <KeyStatusBadge status={status} />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="ocr-key"
                  type="password"
                  value={keyInput}
                  autoComplete="off"
                  placeholder={status.hasKey ? '••••••••' : t('settings.ai.apiKeyPlaceholder')}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={saveKey}
                  disabled={keyInput.trim().length === 0 || setKey.isPending}
                >
                  {t('settings.ai.save')}
                </Button>
                {status.hasKey && status.keySource === 'app' && (
                  <Button variant="outline" onClick={removeKey} disabled={deleteKey.isPending}>
                    {t('settings.ai.deleteKey')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-text-muted">{t('settings.ai.ocr.keyShared')}</p>
            </div>
          )}

          {/* Actions: test + save the OCR model */}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={runTest} disabled={testConn.isPending}>
              {testConn.isPending ? t('settings.ai.testing') : t('settings.ai.test')}
            </Button>
            <Button onClick={saveModel} disabled={updateSettings.isPending}>
              {t('settings.ai.save')}
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1.5 text-xs ${
                  testResult.ok ? 'text-success' : 'text-danger'
                }`}
              >
                {testResult.ok ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
                {testDetailMessage(t, testResult)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
