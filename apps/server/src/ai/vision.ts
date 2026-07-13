import type { VisionMediaType } from '@engram/shared'
import { PROVIDERS } from './providers'
import type { ResolvedProviderConfig } from './providers/types'

/**
 * OCR vision boundary (spec §2.2), calqued on `ai/generator.ts`'s injectable
 * `CardGenerator` registry. The default extractor delegates to the CONFIGURED
 * provider's `completeVision` transport (Anthropic image blocks, OpenAI-compat
 * `image_url`, Ollama `images[]`); tests inject a fake via `setVisionExtractor`,
 * so no network is ever touched in the suite/CI.
 */

export interface VisionExtractArgs {
  /** Raw (already client-downscaled) image bytes. */
  image: Uint8Array
  /** Concrete media type, from magic-byte detection (`detectImageMedia`). */
  mediaType: VisionMediaType
  /** OCR system prompt (faithful transcription rules). */
  systemPrompt: string
  /** User instruction accompanying the image. */
  instruction: string
  /** Optional external cancellation (combined with the internal per-call timeout). */
  signal?: AbortSignal
  /**
   * Original filename — informational only. The fake extractor honours the
   * `__E2E_OCR_*` sentinels through it (spec §2.2); the real path ignores it.
   */
  filename?: string
  /**
   * Resolved provider config. Provided by the route (resolved ONCE, mirroring
   * `generations.ts`); absent only for direct calls, where the default
   * extractor re-resolves it.
   */
  provider?: ResolvedProviderConfig
}

export interface VisionExtractResult {
  markdown: string
  promptTokens: number
  completionTokens: number
}

/** Injectable boundary. The extract-image route depends ONLY on this. */
export interface VisionExtractor {
  /** Extraction of ONE image (= 1 vision call, spec §4). */
  extract(args: VisionExtractArgs): Promise<VisionExtractResult>
  /** True iff the given provider config supports vision (guard BEFORE any call). */
  supportsVision(cfg: ResolvedProviderConfig): boolean
}

/** Timeout PER vision call (mirrors the generator's `PER_CALL_TIMEOUT_MS`). */
const PER_CALL_TIMEOUT_MS = 90_000

/**
 * The DEFAULT extractor: resolves the active provider (or takes the pre-resolved
 * one) and delegates to the matching adapter's `completeVision`. No retry (a
 * transcription is not a JSON output to re-validate) — retry is a user gesture
 * per page (spec §2.2/§3.3).
 */
export const configuredVisionExtractor: VisionExtractor = {
  supportsVision(cfg) {
    const adapter = PROVIDERS[cfg.providerId]
    return adapter.completeVision !== undefined && (adapter.supportsVision?.(cfg) ?? false)
  },

  async extract(args) {
    let cfg = args.provider
    if (!cfg) {
      const { db } = await import('../db/client')
      const { resolveActiveProvider } = await import('../services/ai-config.service')
      cfg = (await resolveActiveProvider(db)) ?? undefined
    }
    if (!cfg) throw new Error('vision extraction unavailable: no provider configured')
    const adapter = PROVIDERS[cfg.providerId]
    if (!adapter.completeVision || !(adapter.supportsVision?.(cfg) ?? false)) {
      throw new Error('vision extraction unavailable: provider does not support vision')
    }

    const timeout = AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
    const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout
    const res = await adapter.completeVision(cfg, {
      system: args.systemPrompt,
      instruction: args.instruction,
      image: args.image,
      mediaType: args.mediaType,
      signal,
    })
    return {
      markdown: res.markdown,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
    }
  },
}

// --- Mutable registry (injection boundary; strictly the CardGenerator pattern) ---
let active: VisionExtractor = configuredVisionExtractor
export function getVisionExtractor(): VisionExtractor {
  return active
}
/** Test/e2e only. */
export function setVisionExtractor(v: VisionExtractor): void {
  active = v
}
/** Test/e2e only. */
export function resetVisionExtractor(): void {
  active = configuredVisionExtractor
}

/**
 * Deterministic post-processing of a transcription (spec §2.3): count the
 * uncertainty markers the OCR prompt emits (`[?]`, `[illisible]`) into
 * human-readable warnings for the preview UI. Pure — no model call.
 */
export function computeOcrWarnings(markdown: string): string[] {
  const warnings: string[] = []
  const uncertain = (markdown.match(/\[\?\]/g) ?? []).length
  const illegible = (markdown.match(/\[illisible\]/gi) ?? []).length
  if (uncertain > 0) {
    warnings.push(`transcription incertaine : ${uncertain} marqueur(s) [?]`)
  }
  if (illegible > 0) {
    warnings.push(illegible === 1 ? '1 passage illisible' : `${illegible} passages illisibles`)
  }
  return warnings
}
