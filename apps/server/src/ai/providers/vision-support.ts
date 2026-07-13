/**
 * Best-effort, model-name driven vision-capability heuristics (spec §2.2). Used
 * as a PRE-CALL guard so a text-only configuration returns a clean 503 instead
 * of a confusing upstream error. Pure + unit-tested.
 *
 * The reliably-detectable case is a local Ollama model with no vision head
 * (e.g. `gemma3:1b`, `llama3.1`): those are hard `false`. Cloud providers pass
 * arbitrary model ids we cannot enumerate, so they default to permissive
 * `true` — a genuinely text-only cloud model still surfaces its own upstream
 * error, which bubbles to the client for a per-page retry.
 */

/** Anthropic: every supported Claude 3+/4 model is multimodal; legacy is not. */
export function anthropicSupportsVision(model: string): boolean {
  const m = model.toLowerCase()
  return !/claude-2|claude-instant/.test(m)
}

/** Ollama vision families (local, offline). */
const OLLAMA_VISION_MARKERS =
  /(llava|bakllava|moondream|minicpm-?v|llama-?3\.2-vision|llama3\.2-vision|qwen2\.?5?-?vl|pixtral|granite3\.2-vision|mistral-small3|gemma3)/i

export function ollamaSupportsVision(model: string): boolean {
  const m = model.toLowerCase()
  // gemma3 is multimodal at 4b/12b/27b but TEXT-ONLY at 1b.
  if (/gemma3/.test(m) && /(^|[:@\-_])1b\b/.test(m)) return false
  return OLLAMA_VISION_MARKERS.test(m)
}

/**
 * OpenAI-compatible clouds (OpenRouter, generic gateways): can't reliably
 * enumerate vision models → permissive `true`. A text-only model still errors
 * upstream and bubbles to the client.
 */
export function openAiCompatSupportsVision(): boolean {
  return true
}
