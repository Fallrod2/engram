import { describe, expect, it } from 'vitest'
import { openHandle, sealHandle } from './codex-handle'

const args = { deviceAuthId: 'dev-1', userCode: 'ABCD-1234', userId: 'user-a' }

describe('codex link handle (stateless, user-bound)', () => {
  it('round-trips for the same user', () => {
    const h = sealHandle(args)
    expect(openHandle(h, 'user-a')).toEqual({ deviceAuthId: 'dev-1', userCode: 'ABCD-1234' })
  })

  it('rejects a handle presented by a DIFFERENT user (binding)', () => {
    const h = sealHandle(args)
    expect(openHandle(h, 'attacker')).toBeNull()
  })

  it('rejects a tampered handle (bad HMAC)', () => {
    const h = sealHandle(args)
    const tampered = `${h.slice(0, -2)}xy`
    expect(openHandle(tampered, 'user-a')).toBeNull()
  })

  it('rejects a malformed handle', () => {
    expect(openHandle('garbage', 'user-a')).toBeNull()
    expect(openHandle('', 'user-a')).toBeNull()
  })
})
