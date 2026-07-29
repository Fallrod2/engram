import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Info } from 'lucide-react'
import type { AiProviderId } from '@engram/shared'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { meQuery } from '@/features/admin/queries'
import { useSetAiKey, useUpdateAiSettings } from '@/features/ai/queries'
import {
  PROVIDER_KEY_EXAMPLE,
  PROVIDER_KEY_URLS,
  PROVIDER_ORDER,
  providerLabel,
  providerUsesKey,
} from '@/features/ai/providers'

/**
 * Step 3 — connecting an AI provider, and the ONE step that asks for a secret.
 *
 * ═══ THE KEY NEVER LIVES IN THE BROWSER ═══
 *
 * Same path as the settings card, on purpose: `PUT /api/ai/providers/:id/key`
 * writes it into the `ai_credential` table and answers `204`. No DTO ever reads
 * a secret back, the field is `type="password"` with `autoComplete="off"`, it is
 * never pre-filled, and the local state is dropped the moment the PUT succeeds.
 * Nothing here stores a key in `localStorage`, in a query cache or in a URL.
 *
 * ═══ THE REFUSAL IS SPELLED OUT, WITHOUT DRAMA ═══
 *
 * Alex insisted, and it is the right call: someone declining has to know what
 * they are declining. The three consequences are listed IN the step, visible
 * before the decision rather than shouted after it — no card generation from a
 * note, no use of an imported PDF's text, no OCR on a photo. Followed by what
 * still works, which is most of the product, and by the fact that a key can be
 * added later. No guilt, no dark pattern, no disabled "skip".
 *
 * ═══ THE DEMO ACCOUNT ═══
 *
 * It is SHARED, and the server already refuses every AI write from it
 * (`requireNotDemo`). Rendering the field anyway would offer a visitor an action
 * that can only end in a 403 — and would invite them to paste a personal key
 * into a shared account. So the field is replaced by a plain statement of why.
 */
export function AiStep({ onSaved }: { onSaved: () => void }) {
  const t = useT()
  const me = useQuery(meQuery())
  const setKey = useSetAiKey()
  const updateSettings = useUpdateAiSettings()
  const [provider, setProvider] = useState<AiProviderId>('anthropic')
  const [keyInput, setKeyInput] = useState('')

  const isDemo = me.data?.isDemo === true
  const trimmed = keyInput.trim()
  const saving = setKey.isPending || updateSettings.isPending

  /**
   * Two writes, in this order and only when a key was actually typed:
   *   1. the secret (204, write-only);
   *   2. the active provider, so the key the user just gave is the one the app
   *      will use. Skipping step 2 would leave someone who pasted a Mistral key
   *      with Anthropic still active, and a "why does nothing work" bug report.
   * The provider PATCH is best-effort: the key is what the user came to give,
   * and failing to switch the active provider is recoverable from Settings.
   */
  function save() {
    if (trimmed.length === 0) return
    setKey.mutate(
      { provider, key: trimmed },
      {
        onSuccess: () => {
          setKeyInput('')
          updateSettings.mutate({ activeProvider: provider })
          onSaved()
        },
        onError: () => toast.error(t('onboarding.journey.ai.saveError')),
      },
    )
  }

  const url = PROVIDER_KEY_URLS[provider]
  const example = PROVIDER_KEY_EXAMPLE[provider]

  return (
    <div className="flex flex-col gap-5">
      {isDemo ? (
        <p className="flex items-start gap-2 rounded-sm border border-border bg-surface-2/60 p-3 text-xs leading-relaxed text-text-muted">
          <Info aria-hidden className="mt-px size-3.5 shrink-0 text-text-faint" />
          <span>{t('onboarding.journey.ai.demoNotice')}</span>
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="onboarding-ai-provider">{t('onboarding.journey.ai.provider')}</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as AiProviderId)
                // A key belongs to ONE provider. Carrying it across the switch
                // would send an Anthropic secret to Mistral's credential row.
                setKeyInput('')
              }}
            >
              <SelectTrigger id="onboarding-ai-provider" className="w-48">
                <SelectValue placeholder={t('onboarding.journey.ai.provider')} />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ORDER.filter(providerUsesKey).map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(t, p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-ai-key">{t('onboarding.journey.ai.key')}</Label>
            <Input
              id="onboarding-ai-key"
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={t('onboarding.journey.ai.keyPlaceholder')}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed.length > 0) {
                  e.preventDefault()
                  save()
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  {t('settings.ai.getKey')}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
              {example && (
                <p className="text-xs text-text-muted">
                  {t('settings.ai.keyLooksLike', { example })}
                </p>
              )}
            </div>
            <p className="text-xs leading-relaxed text-text-faint">
              {t('onboarding.journey.ai.keyServerSide')}
            </p>
          </div>

          <Button onClick={save} disabled={trimmed.length === 0 || saving} className="self-start">
            {saving ? t('onboarding.journey.ai.saving') : t('onboarding.journey.ai.save')}
          </Button>
        </>
      )}

      {/* WHAT SKIPPING COSTS — stated before the decision, not after it. */}
      <div className="flex flex-col gap-2 rounded-sm border border-border bg-surface-2/60 p-3">
        <p className="text-xs font-semibold text-text">
          {t('onboarding.journey.ai.consequencesTitle')}
        </p>
        <ul className="ml-4 list-disc text-xs leading-relaxed text-text-muted">
          <li>{t('onboarding.journey.ai.consequenceCards')}</li>
          <li>{t('onboarding.journey.ai.consequencePdf')}</li>
          <li>{t('onboarding.journey.ai.consequenceOcr')}</li>
        </ul>
        <p className="text-xs leading-relaxed text-text-muted">
          {t('onboarding.journey.ai.consequencesRest')}
        </p>
      </div>
    </div>
  )
}
