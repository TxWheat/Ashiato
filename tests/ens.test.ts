import { afterEach, describe, expect, it, vi } from 'vitest'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { lookupEnsNames, namehash } from '@/lib/ens'

afterEach(() => vi.unstubAllGlobals())

describe('namehash (EIP-137 test vectors)', () => {
  it('matches the spec', () => {
    expect(namehash('')).toBe('0x' + '0'.repeat(64))
    expect(namehash('eth')).toBe('0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae')
    expect(namehash('foo.eth')).toBe('0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f')
  })
})

const RESOLVER = '0x' + '4'.repeat(40)
const pad = (h: string) => h.replace(/^0x/, '').padStart(64, '0')
const encString = (s: string) => {
  const hex = Buffer.from(s).toString('hex')
  return '0x' + pad('20') + pad(s.length.toString(16)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
}

/** Fake chain: reverse records plus forward records */
function mockRpc(reverse: Record<string, string>, forward: Record<string, string>) {
  const byNode = new Map<string, string>()
  for (const [a, n] of Object.entries(reverse)) byNode.set(namehash(`${a.slice(2)}.addr.reverse`), n)
  const fwd = new Map<string, string>()
  for (const [n, a] of Object.entries(forward)) fwd.set(namehash(n), a)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const calls = JSON.parse(init.body) as { id: number; params: [{ to: string; data: string }] }[]
    return new Response(JSON.stringify(calls.map(c => {
      const data = c.params[0].data
      const sel = data.slice(2, 10)
      const node = '0x' + data.slice(10, 74)
      let result = '0x' + pad('0')
      if (sel === '0178b8bf' && (byNode.has(node) || fwd.has(node))) result = '0x' + pad(RESOLVER)
      if (sel === '691f3431' && byNode.has(node)) result = encString(byNode.get(node)!)
      if (sel === '3b3b57de' && fwd.has(node)) result = '0x' + pad(fwd.get(node)!)
      return { jsonrpc: '2.0', id: c.id, result }
    })))
  })
}

describe('lookupEnsNames', () => {
  const alice = '0x' + 'a'.repeat(40)
  const spoofer = '0x' + 'b'.repeat(40)

  it('returns forward-verified names and drops spoofed reverse records', async () => {
    mockRpc(
      { [alice]: 'alice.eth', [spoofer]: 'binance.eth' },
      { 'alice.eth': alice, 'binance.eth': '0x' + 'c'.repeat(40) }
    )
    const names = await lookupEnsNames([alice, spoofer])
    expect(names.get(alice)).toBe('alice.eth')
    expect(names.has(spoofer)).toBe(false)
  })

  it('never throws when the RPC is down', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }))
    await expect(lookupEnsNames(['0x' + 'd'.repeat(40)])).resolves.toEqual(new Map())
  })

  it('uses keccak-256 (sanity)', () => {
    expect(Buffer.from(keccak_256(new TextEncoder().encode('eth'))).toString('hex')).toBe('4f5b812789fc606be1b3b16908db13fc7a9adf7ca72641f84d75b47069d3d7f0')
  })
})
