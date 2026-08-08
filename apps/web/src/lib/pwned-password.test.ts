import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkPwnedPassword, HIBP_TIMEOUT_MS, isBreachedPassword } from './pwned-password'

/**
 * Breached-password check (A-4). Every test here mocks `fetch` — this suite must
 * NEVER reach the real HIBP, both because a unit test has no business on the
 * network and because the whole point of the module is what it does and does not
 * put on the wire.
 *
 * The vector is the canonical one: SHA-1('password') =
 * 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8, so prefix `5BAA6` and suffix
 * `1E4C9B93F3F0682250B6CF8331B7EE68FD8` (35 chars).
 */
const PASSWORD_HASH = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'
const PASSWORD_PREFIX = PASSWORD_HASH.slice(0, 5)
const PASSWORD_SUFFIX = PASSWORD_HASH.slice(5)

const fetchMock = vi.fn()

/** A body shaped like HIBP's: `SUFFIX:COUNT` lines, CRLF-separated. */
function body(lines: string[]): string {
  return lines.join('\r\n')
}

/** Resolve `fetch` with a 200 carrying `text`. */
function respondWith(text: string, status = 200): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('checkPwnedPassword — the request', () => {
  it('hashes with SHA-1 and sends only the 5-character prefix, with padding on', async () => {
    respondWith(body([`${PASSWORD_SUFFIX}:10382543`]))
    await checkPwnedPassword('password')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`)
    expect(init.method).toBe('GET')
    // HIBP's own recommendation: pad the response so its SIZE leaks nothing.
    expect(init.headers).toMatchObject({ 'Add-Padding': 'true' })
    expect(init.body).toBeUndefined()
  })

  it('never puts the password, or more than 5 hex characters of its hash, on the wire', async () => {
    // A password whose plaintext cannot be confused with anything in the URL —
    // note that the HOST itself contains the word "passwords".
    const secret = 'Tr0ub4dor&3-correct-horse-battery-staple'
    respondWith(body([]))
    await checkPwnedPassword(secret)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // Everything that leaves this machine, flattened: URL + every header + body.
    const onTheWire = `${url} ${JSON.stringify(init)}`

    expect(onTheWire).not.toContain(secret)
    expect(onTheWire).not.toContain('Tr0ub4dor')
    // No 6th hex character of the hash: the prefix is present, one more is not.
    const sixChars = url.slice(url.lastIndexOf('/') + 1)
    expect(sixChars).toHaveLength(5)
    expect(/^[0-9A-F]{5}$/.test(sixChars)).toBe(true)
    // And the suffix — the part that would make the hash crackable — stays home.
    expect(onTheWire.length).toBeLessThan(200)
  })

  it('sends the whole hash to nobody: the 35-char suffix is compared locally', async () => {
    respondWith(body([`${PASSWORD_SUFFIX}:10382543`]))
    await checkPwnedPassword('password')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const onTheWire = `${url} ${JSON.stringify(init)}`
    expect(onTheWire).not.toContain(PASSWORD_SUFFIX)
    expect(onTheWire).not.toContain(PASSWORD_HASH)
    expect(onTheWire).not.toContain(PASSWORD_HASH.slice(0, 6))
  })
})

describe('checkPwnedPassword — the verdict', () => {
  it('reports a compromised password when its suffix is listed', async () => {
    respondWith(
      body([
        '0018A45C4D1DEF81644B54AB7F969B88D65:1',
        `${PASSWORD_SUFFIX}:10382543`,
        '011053FD0102E94D6AE2F8B83D76FAF94F6:1',
      ]),
    )
    expect(await checkPwnedPassword('password')).toEqual({ compromised: true })
  })

  it('reports a clean password when its suffix is absent from the range', async () => {
    respondWith(
      body(['0018A45C4D1DEF81644B54AB7F969B88D65:1', '011053FD0102E94D6AE2F8B83D76FAF94F6:7']),
    )
    expect(await checkPwnedPassword('password')).toEqual({ compromised: false })
  })

  it('ignores the zero-count decoys that Add-Padding injects', async () => {
    // The padding uses real-looking suffixes at count 0. Matching one would
    // refuse a password that has never been breached at all.
    respondWith(body([`${PASSWORD_SUFFIX}:0`, '0018A45C4D1DEF81644B54AB7F969B88D65:0']))
    expect(await checkPwnedPassword('password')).toEqual({ compromised: false })
  })

  it('matches case-insensitively (HIBP returns upper hex, but we do not bet on it)', async () => {
    respondWith(body([`${PASSWORD_SUFFIX.toLowerCase()}:10382543`]))
    expect(await checkPwnedPassword('password')).toEqual({ compromised: true })
  })

  it('tolerates a body with LF endings, blank lines and junk', async () => {
    respondWith(`\n\ngarbage-with-no-colon\n${PASSWORD_SUFFIX}:42\n`)
    expect(await checkPwnedPassword('password')).toEqual({ compromised: true })
  })

  it('treats an unparseable count as no match rather than a hit', async () => {
    respondWith(body([`${PASSWORD_SUFFIX}:not-a-number`]))
    expect(await checkPwnedPassword('password')).toEqual({ compromised: false })
  })
})

describe('checkPwnedPassword — fail-open', () => {
  // The direction of this trade is deliberate (see the module header): a HIBP
  // outage must never cost an account. Every one of these MUST resolve
  // `unavailable`, and none may ever resolve `compromised: true`.
  it('returns unavailable on a non-200 (rate limit, 5xx…)', async () => {
    respondWith('', 503)
    expect(await checkPwnedPassword('password')).toEqual({ unavailable: true })
  })

  it('returns unavailable when the network refuses (offline, blocked, CORS)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await checkPwnedPassword('password')).toEqual({ unavailable: true })
  })

  it('returns unavailable when the body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('stream broke')
      },
    })
    expect(await checkPwnedPassword('password')).toEqual({ unavailable: true })
  })

  it('aborts and returns unavailable when HIBP is too slow', async () => {
    // A fetch that only ever settles when the signal aborts — i.e. a hung
    // request. Without the timeout this test would never finish, which is the
    // point: it proves the abort is WIRED, not merely configured. `timeoutMs`
    // is the test seam; production uses HIBP_TIMEOUT_MS.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
        }),
    )
    expect(await checkPwnedPassword('password', { timeoutMs: 5 })).toEqual({ unavailable: true })
  })

  it('keeps the production ceiling short enough to sit inside a submit', () => {
    expect(HIBP_TIMEOUT_MS).toBeGreaterThan(0)
    expect(HIBP_TIMEOUT_MS).toBeLessThanOrEqual(3000)
  })
})

describe('isBreachedPassword', () => {
  it('is true only when HIBP answered yes', () => {
    expect(isBreachedPassword({ compromised: true })).toBe(true)
    expect(isBreachedPassword({ compromised: false })).toBe(false)
    // The one that matters: "no answer" must never read as "refuse".
    expect(isBreachedPassword({ unavailable: true })).toBe(false)
  })
})
