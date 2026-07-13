import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, RotateCw, X } from 'lucide-react'
import type {
  AiProviderId,
  AiProviderStatus,
  AiSettings,
  TestConnectionResponse,
  UpdateAiSettings,
} from '@engram/shared'
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
  useDeleteAiKey,
  useProviderModels,
  useSetAiKey,
  useTestConnection,
  useUpdateAiSettings,
} from './queries'

const PROVIDER_ORDER: AiProviderId[] = ['anthropic', 'openrouter', 'ollama', 'openai-compat']

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
          <AiSettingsBody settings={settingsQ.data.settings} statuses={settingsQ.data.statuses} />
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

  const requiresKey = active !== 'ollama'
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
        onError: () => toast.error(t('settings.ai.saveError')),
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
        onError: () => toast.error(t('settings.ai.saveError')),
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

      <p className="text-xs leading-relaxed text-text-muted">{t('settings.ai.claudeHint')}</p>
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
