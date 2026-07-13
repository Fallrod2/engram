import Anthropic from '@anthropic-ai/sdk'

/** True iff a non-empty Anthropic API key is available in the environment. */
export function hasAnthropicKey(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0
}

/**
 * Build an Anthropic client, lazily (never at module load). With no `apiKey`,
 * `new Anthropic()` resolves the credential chain itself (`ANTHROPIC_API_KEY`,
 * then an `ant auth login` machine profile) — the env/machine fallback. Pass an
 * explicit `apiKey` to use a key stored in the app config (or a candidate under
 * test), bypassing the env.
 */
export function createAnthropic(opts?: { apiKey?: string }): Anthropic {
  const apiKey = opts?.apiKey?.trim()
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic()
}

/** Factory type, so adapters/tests can inject a fake Anthropic client builder. */
export type CreateAnthropic = typeof createAnthropic
