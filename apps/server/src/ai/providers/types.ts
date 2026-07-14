import type { AiProviderId, TestConnectionDetailCode, VisionMediaType } from '@engram/shared'

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
  /**
   * OAuth access, for subscription providers (openai-codex). Distinct from
   * `secret`: the adapter sees ONLY a fresh access token (+ account id), never
   * the refresh token, which the resolver rotates in the DB (audit A2/B6). The
   * `accountId` is the required `chatgpt-account-id` backend header.
   */
  oauth?: { accessToken: string; accountId?: string | undefined }
}

/**
 * The structured-output contract for ONE generation kind, wrapped differently by
 * each provider (Anthropic tool, OpenAI function / json_schema, Ollama format).
 * Optional on `ProviderCompleteArgs` so the wire stays byte-identical for the v1
 * kinds (cards/quiz): the orchestrator only sets it for `mixed` (→ v2 schema).
 * Adapters fall back to their statically-imported v1 constants when it's absent.
 */
export interface EmitSpec {
  /** Tool / function description string. */
  description: string
  /** Naked JSON Schema of the emit payload (`{ cards: [...] }`). */
  schema: Record<string, unknown>
  /** Anthropic tool definition (`{ name, description, input_schema }`). */
  tool: {
    name: string
    description: string
    input_schema: { type: 'object'; [k: string]: unknown }
  }
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
  /**
   * Per-kind structured-output contract. Absent → the adapter uses its v1
   * constants (cards/quiz, byte-identical wire). Set by the orchestrator for the
   * `mixed` kind so the wire carries the v2 (qa|cloze) schema.
   */
  emit?: EmitSpec
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

/** One vision (image → Markdown) call, spec §2.2. */
export interface ProviderVisionArgs {
  /** OCR system prompt (faithful transcription rules). */
  system: string
  /** User instruction accompanying the image. */
  instruction: string
  /** Raw (already client-downscaled) image bytes. */
  image: Uint8Array
  /** Concrete media type, from magic-byte detection. */
  mediaType: VisionMediaType
  /** Per-call timeout signal, provided by the vision orchestrator. */
  signal: AbortSignal
}

export interface ProviderVisionResult {
  /** Transcribed Markdown (free text — no structured tool). */
  markdown: string
  promptTokens: number
  completionTokens: number
}

export interface TestConnectionResult {
  ok: boolean
  /**
   * i18n-neutral outcome code (NO hardcoded server-side text). The client maps
   * it to a localized string. Guaranteed to never carry a secret by design.
   */
  detailCode: TestConnectionDetailCode
  /** Upstream HTTP status, when known — the UI appends it to the message. */
  httpStatus?: number
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
  /**
   * Whether THIS provider + the configured model can accept an image (spec
   * §2.2). Best-effort, model-name driven; absent = no vision transport at all.
   * Consulted as a guard BEFORE any call (→ 503 for a text-only provider).
   */
  supportsVision?(cfg: ResolvedProviderConfig): boolean
  /**
   * One vision completion (image → Markdown transcription). Present iff the
   * provider has a vision transport; the OCR service guards with
   * `supportsVision` first. Throws on network/HTTP/format failure (bubbles up).
   */
  completeVision?(
    cfg: ResolvedProviderConfig,
    args: ProviderVisionArgs,
  ): Promise<ProviderVisionResult>
}

/** Injected fetch (default `globalThis.fetch`) so tests never touch the network. */
export type FetchFn = typeof globalThis.fetch
