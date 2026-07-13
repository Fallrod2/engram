import type { FetchFn } from './types'

/**
 * Lazy default fetch: resolves `globalThis.fetch` AT CALL TIME (not at module
 * load), so a test that reassigns `globalThis.fetch` is honoured by the default
 * adapter instances built in `providers/index.ts`.
 */
export const defaultFetch: FetchFn = ((
  input: Parameters<FetchFn>[0],
  init?: Parameters<FetchFn>[1],
) => globalThis.fetch(input, init)) as FetchFn

/** Max output tokens per call — mapped to each provider's own param. */
export const MAX_OUTPUT_TOKENS = 8192

/** Base64-encode raw bytes (image payload for the vision APIs). */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Default base URLs (used when the stored config leaves them empty). */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'

/**
 * Actionable error thrown when, after all attempts, a model returned neither a
 * tool/function call nor parseable JSON. Surfaces in the failed generation row
 * and the import UI — never a generic opaque throw.
 */
export function unstructuredOutputError(model: string): Error {
  return new Error(
    `Le modèle « ${model} » n'a pas renvoyé de sortie structurée exploitable (JSON/outils). ` +
      'Choisis un modèle compatible ou un autre provider.',
  )
}
