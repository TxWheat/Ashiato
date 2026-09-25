import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
import { createSession, makeNonce, nonceValid, readSessionToken } from '@/lib/auth/session'

const ME = '0xabcdef0000000000000000000000000000000001'

describe('sign-in nonces', () => {
  it('are alphanumeric, valid for 10 minutes, and unforgeable', () => {
    const now = 1_790_000_000_000
    const n = makeNonce(now)
    expect(n).toMatch(/^[a-zA-Z0-9]{33}$/)
    expect(nonceValid(n, now + 60_000)).toBe(true)
    expect(nonceValid(n, now + 11 * 60_000)).toBe(false)
    expect(nonceValid(n.slice(0, 9) + 'A'.repeat(24), now)).toBe(false)
    expect(nonceValid('hello', now)).toBe(false)
  })
})

describe('sessions', () => {
  it('round-trip the address and expire after 30 days', () => {
    const now = Date.now()
    const t = createSession(ME.toUpperCase().replace('0X', '0x'), now)
    expect(readSessionToken(t, now)).toBe(ME)
    expect(readSessionToken(t, now + 31 * 86400_000)).toBeNull()
  })
  it('reject tampering', () => {
    const t = createSession(ME)
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ a: '0x' + '9'.repeat(40), e: Date.now() + 1e9 })).toString('base64url')
    expect(readSessionToken(`${forged}.${sig}`)).toBeNull()
    expect(readSessionToken(`${body}.${sig.slice(0, -2)}xx`)).toBeNull()
    expect(readSessionToken(undefined)).toBeNull()
  })
})
