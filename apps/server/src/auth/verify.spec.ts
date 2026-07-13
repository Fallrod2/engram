import { describe, expect, it } from 'bun:test'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JSONWebKeySet } from 'jose'
import { jwksUrl, makeJwksVerifier, makeHs256Verifier } from './verify'

/**
 * Real `jose`, ZERO network (spec §6.1). The ES256 public key is served through
 * an injected `createLocalJWKSet`, so `makeJwksVerifier` verifies genuine tokens
 * locally. Covers `aud`/`iss`/signature/`exp` and anti alg-confusion (audit §4).
 */

const SUPABASE_URL = 'https://x.supabase.co'
const ISSUER = `${SUPABASE_URL}/auth/v1`

async function es256Fixture() {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  const jwks: JSONWebKeySet = { keys: [{ ...jwk, alg: 'ES256', use: 'sig', kid: 'test-key' }] }
  const localJwks = createLocalJWKSet(jwks)
  const verify = makeJwksVerifier(SUPABASE_URL, localJwks)
  return { privateKey, verify }
}

function baseToken() {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject('user-uuid')
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
}

describe('jwksUrl (audit §12)', () => {
  it('pins the /auth/v1/.well-known/jwks.json path', () => {
    expect(jwksUrl(SUPABASE_URL).href).toBe('https://x.supabase.co/auth/v1/.well-known/jwks.json')
  })
})

describe('makeJwksVerifier (ES256, local JWKS)', () => {
  it('accepts a valid token and returns its claims', async () => {
    const { privateKey, verify } = await es256Fixture()
    const token = await baseToken().sign(privateKey)
    const claims = await verify(token)
    expect(claims.sub).toBe('user-uuid')
    expect(claims.aud).toBe('authenticated')
  })

  it('rejects a wrong audience (audit §11)', async () => {
    const { privateKey, verify } = await es256Fixture()
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience('anon')
      .setExpirationTime('1h')
      .sign(privateKey)
    await expect(verify(token)).rejects.toThrow()
  })

  it('rejects a wrong issuer', async () => {
    const { privateKey, verify } = await es256Fixture()
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer('https://evil.example/auth/v1')
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(privateKey)
    await expect(verify(token)).rejects.toThrow()
  })

  it('rejects a tampered signature', async () => {
    const { privateKey, verify } = await es256Fixture()
    const token = await baseToken().sign(privateKey)
    const tampered = token.slice(0, -3) + (token.endsWith('a') ? 'bbb' : 'aaa')
    await expect(verify(tampered)).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    const { privateKey, verify } = await es256Fixture()
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey)
    await expect(verify(token)).rejects.toThrow()
  })

  it('rejects an HS256 token on the ES256 path (anti alg-confusion, audit §4)', async () => {
    const { verify } = await es256Fixture()
    const secret = new TextEncoder().encode('a-shared-secret-at-least-32-bytes-long!!')
    const hsToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(secret)
    await expect(verify(hsToken)).rejects.toThrow()
  })
})

describe('makeHs256Verifier (fallback)', () => {
  it('accepts a valid HS256 token', async () => {
    const secret = 'a-shared-secret-at-least-32-bytes-long!!'
    const verify = makeHs256Verifier(secret)
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))
    const claims = await verify(token)
    expect(claims.aud).toBe('authenticated')
  })

  it('rejects a wrong audience', async () => {
    const secret = 'a-shared-secret-at-least-32-bytes-long!!'
    const verify = makeHs256Verifier(secret)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('anon')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))
    await expect(verify(token)).rejects.toThrow()
  })
})
