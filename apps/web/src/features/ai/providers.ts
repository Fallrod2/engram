import type { AiProviderId } from '@engram/shared'
import type { TFunction } from '@/lib/i18n'

/**
 * What the two AI surfaces both need to know about the providers: the order they
 * are offered in, how they are named, where a key is obtained and what one looks
 * like.
 *
 * Extracted from `ai-settings-card.tsx` when the first-run journey grew its own
 * (much smaller) AI step (T-049). The journey offers the same providers and the
 * same "obtain a key" affordance; duplicating the tables would have meant a new
 * provider appearing in the settings screen and silently not in the journey.
 * Everything specific to the full settings card — model presets, OCR slot,
 * codex link flow — deliberately stayed there.
 */

export const PROVIDER_ORDER: AiProviderId[] = [
  'anthropic',
  'openrouter',
  'ollama',
  'openai-compat',
  'mistral',
  'openai-codex',
]

/** Console URL where a non-tech user obtains a key, per key-based provider. */
export const PROVIDER_KEY_URLS: Partial<Record<AiProviderId, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys',
  mistral: 'https://console.mistral.ai/api-keys',
}

/**
 * A short "your key looks like…" example prefix, per key-based provider. Only
 * providers with a recognisable prefix are listed (Mistral keys have none).
 */
export const PROVIDER_KEY_EXAMPLE: Partial<Record<AiProviderId, string>> = {
  anthropic: 'sk-ant-…',
  openrouter: 'sk-or-…',
}

export function providerLabel(t: TFunction, p: AiProviderId): string {
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

/** Short label for a Select trigger — keeps it on one line. */
export function providerShortLabel(t: TFunction, p: AiProviderId): string {
  return p === 'openai-codex' ? 'ChatGPT' : providerLabel(t, p)
}

/**
 * Does this provider authenticate with a pasted API key? `ollama` runs locally
 * and needs none; `openai-codex` is linked by OAuth and REFUSES a key server-side
 * (`setAiKey` throws for it). The journey's AI step offers only the providers for
 * which "paste your key here" is a true sentence.
 */
export function providerUsesKey(p: AiProviderId): boolean {
  return p !== 'ollama' && p !== 'openai-codex'
}
