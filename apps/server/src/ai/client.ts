import Anthropic from '@anthropic-ai/sdk'

/** True iff a non-empty Anthropic API key is available in the environment. */
export function hasAnthropicKey(): boolean {
  return (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0
}

/**
 * Build an Anthropic client. Call this ONLY when `hasAnthropicKey()` is true —
 * the `/generations` route guards on the key and returns 503 otherwise (§3.2),
 * so the client is created lazily at call time, never at module load.
 */
export function createAnthropic(): Anthropic {
  return new Anthropic() // reads ANTHROPIC_API_KEY from the environment
}
