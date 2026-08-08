/**
 * Breached-password check against HaveIBeenPwned's Pwned Passwords range API
 * (A-4, option 2 — decided 08/08/2026).
 *
 * WHY THIS EXISTS AT ALL. Supabase ships a "leaked password protection" toggle
 * that does exactly this, server-side, on every signup and password change. It
 * is Pro-only: flipping it in the dashboard answers `402 Payment Required` on
 * `PATCH /platform/auth/…/config` — measured, not assumed. So the check is done
 * here instead, in the client, right before the password is submitted.
 *
 * WHAT THIS IS NOT — the limit, stated rather than discovered in review. This is
 * a QUALITY GUARD, not a security boundary. The Supabase anon key ships in the
 * bundle; anyone can call `supabase.auth.signUp` (or `updateUser`) straight from
 * a console and never come near this module. Nothing here can stop that, and
 * nothing here pretends to. It stops a person from *choosing* a password that is
 * already in a public dump — which is the failure mode that actually happens.
 * The enforceable version of this rule exists only on the Pro plan.
 *
 * HOW THE PASSWORD STAYS HERE (k-anonymity). We SHA-1 the password locally, send
 * only the first FIVE hex characters of that hash to
 * `GET https://api.pwnedpasswords.com/range/{prefix}`, and compare the remaining
 * 35 characters against the returned list ourselves. The password never leaves
 * the machine; neither does its full hash. `Add-Padding: true` asks HIBP to
 * stuff the answer with decoy suffixes at count 0 — HIBP's own recommendation,
 * so an observer cannot infer anything from the response SIZE. We drop the
 * zero-count entries when matching; a real hit always carries a count ≥ 1.
 *
 * FAIL-OPEN, DELIBERATELY. Every failure — HTTP error, network refusal, a
 * privacy extension blocking the host, CORS, timeout, a malformed body — returns
 * `{ unavailable: true }`, never `{ compromised: true }`. A HIBP outage must not
 * cost us a signup: the cost of wrongly refusing a legitimate account is
 * immediate and total, the cost of letting one weak password through is a guard
 * that did not fire once. The direction of that trade is a choice, and it is
 * tested (`pwned-password.test.ts`, and the fail-open path on the signup form).
 *
 * ONE CALL, AT SUBMIT. Not per keystroke: that would be a network request per
 * character AND would leak the password's length through the request cadence.
 * No cache either — a cache would only pay off for someone retrying the same
 * rejected password, which is precisely the case we want to keep refusing.
 */

/** HIBP's k-anonymity range endpoint. Free, no key, no account. */
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

/**
 * Hard ceiling on the round trip. Short on purpose: this sits between the user
 * pressing "Create my account" and the account being created, so a slow HIBP
 * must degrade to "unavailable" quickly rather than hold the form hostage.
 */
export const HIBP_TIMEOUT_MS = 2500

/** Length of the hash prefix sent over the wire. HIBP's range API takes 5. */
const PREFIX_LENGTH = 5

/**
 * Outcome of a check.
 *
 * `{ compromised }` means HIBP ANSWERED: `true` = this password is in the
 * corpus, `false` = it is not. `{ unavailable: true }` means we never got an
 * answer — the caller must treat it as "no information", never as "clean" in a
 * sense that would justify weakening anything else, and never as a refusal.
 */
export type PwnedPasswordResult = { compromised: boolean } | { unavailable: true }

/**
 * True only when HIBP answered AND said yes. Exists so the three screens read
 * the same way and nobody re-derives the fail-open direction by hand (a
 * `!result.unavailable && result.compromised` written from memory is one typo
 * away from refusing every signup during an outage). The MEASUREMENT lives here;
 * what to do about it stays in the screen.
 */
export function isBreachedPassword(result: PwnedPasswordResult): boolean {
  return !('unavailable' in result) && result.compromised
}

/** Uppercase hex SHA-1 of `input`, via WebCrypto — no dependency added. */
async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Does `body` list `suffix` with a non-zero count?
 *
 * The body is `SUFFIX:COUNT` per line, CRLF-separated. Two details that a naive
 * `body.includes(suffix)` gets wrong:
 *  · CASE — HIBP returns upper hex today, but the comparison is normalised on
 *    both sides rather than trusting that. A case flip would silently turn every
 *    answer into "not breached", i.e. the guard would stop working without ever
 *    failing loudly.
 *  · COUNT 0 — the padding entries `Add-Padding` adds are real-looking suffixes
 *    with a count of zero. Matching one of those would refuse a password that
 *    has never been breached at all.
 */
function suffixIsListed(body: string, suffix: string): boolean {
  const wanted = suffix.toUpperCase()
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const separator = line.indexOf(':')
    if (separator === -1) continue
    if (line.slice(0, separator).toUpperCase() !== wanted) continue
    const count = Number.parseInt(line.slice(separator + 1), 10)
    return Number.isFinite(count) && count > 0
  }
  return false
}

/**
 * Ask HIBP whether `password` appears in a public breach corpus.
 *
 * Never throws and never rejects: everything that can go wrong resolves to
 * `{ unavailable: true }`. See the module header for why that direction is the
 * safe one here.
 *
 * `timeoutMs` is a seam, not a feature: no caller passes it. It exists so the
 * abort path can be PROVEN in a millisecond instead of asserted by reading the
 * code or paid for with a 2.5-second unit test. Production always gets
 * `HIBP_TIMEOUT_MS`.
 */
export async function checkPwnedPassword(
  password: string,
  { timeoutMs = HIBP_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<PwnedPasswordResult> {
  try {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, PREFIX_LENGTH)
    const suffix = hash.slice(PREFIX_LENGTH)

    // `AbortController` + `setTimeout` rather than `AbortSignal.timeout`: the
    // latter is missing from enough test/runtime environments that the timeout
    // would quietly become "no timeout" in exactly the place we want it proven.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
        method: 'GET',
        // The only thing sent: five hex characters, in the path. No body, no
        // credentials, no cookies — this must not become an identified request.
        headers: { 'Add-Padding': 'true' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) return { unavailable: true }
    const body = await response.text()
    return { compromised: suffixIsListed(body, suffix) }
  } catch {
    // Offline, DNS blocked by a privacy extension, CORS, abort on timeout,
    // WebCrypto unavailable on an exotic runtime: all the same answer.
    return { unavailable: true }
  }
}
