import type { AiProviderId } from '@engram/shared'

export type ProviderId = AiProviderId

/**
 * Fully-resolved provider config, secret included. SERVER-INTERNAL ONLY — never
 * serialized to the client (no DTO carries `secret`).
 */
export interface ResolvedProviderConfig {
  providerId: ProviderId
  model: string
  /** ollama / openai-compat (+ openrouter override). */
  baseUrl?: string
  /** API key; absent for ollama; may come from the DB OR the env. */
  secret?: string
  keySource: 'app' | 'env' | null
}

export interface ProviderCompleteArgs {
  /** SYSTEM_PROMPT (shared, provider-agnostic). */
  system: string
  /** kind instructions + the extract, already assembled. */
  userText: string
  /** Per-attempt timeout signal, provided by the orchestrator. */
  signal: AbortSignal
  /** 1..MAX_ATTEMPTS — lets an adapter switch strategy on the 2nd attempt. */
  attempt: number
}

export interface ProviderCompleteResult {
  /** NORMALISED structured payload — `{ cards: [...] }` object, ready for Zod. */
  emitInput: unknown
  promptTokens: number
  completionTokens: number
}

export interface ProviderModel {
  id: string
  label?: string
}

export interface TestConnectionResult {
  ok: boolean
  /** Short message, WITHOUT any secret; i18n-neutral server-side. */
  detail: string
  /** Returned when the test endpoint exposes them (ollama, openrouter). */
  models?: ProviderModel[]
}

export interface ProviderAdapter {
  readonly id: ProviderId
  readonly requiresKey: boolean
  /** One model call for one chunk. Throw on truncation/invalid format/network. */
  complete(cfg: ResolvedProviderConfig, args: ProviderCompleteArgs): Promise<ProviderCompleteResult>
  /** Light connectivity/auth probe for the test endpoint. Never throws: ok=false. */
  testConnection(cfg: ResolvedProviderConfig): Promise<TestConnectionResult>
  /** Selectable models (ollama /api/tags, openrouter /models). */
  listModels?(cfg: ResolvedProviderConfig): Promise<ProviderModel[]>
}

/** Injected fetch (default `globalThis.fetch`) so tests never touch the network. */
export type FetchFn = typeof globalThis.fetch
