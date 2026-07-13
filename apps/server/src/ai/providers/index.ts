import type { ProviderAdapter, ProviderId } from './types'
import { anthropicAdapter } from './anthropic.provider'
import { openRouterAdapter } from './openrouter.provider'
import { ollamaAdapter } from './ollama.provider'
import { openAiCompatAdapter } from './openai-compat.provider'
import { mistralAdapter } from './mistral.provider'

/**
 * Internal adapter registry (NOT the e2e `CardGenerator` registry). Maps a
 * provider id to its default adapter instance (real transport). Tests build
 * adapters directly with an injected `fetchFn`/`createAnthropic`.
 */
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
  'openai-compat': openAiCompatAdapter,
  mistral: mistralAdapter,
}

export type { ProviderAdapter, ProviderId } from './types'
