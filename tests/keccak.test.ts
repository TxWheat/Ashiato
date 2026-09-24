import { describe, expect, it } from 'vitest'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { keccak256 } from '@/lib/keccak'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const utf8 = (s: string) => new TextEncoder().encode(s)

describe('keccak256', () => {
  it('matches published vectors', () => {
    expect(hex(keccak256(utf8('')))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(hex(keccak256(utf8('eth')))).toBe('4f5b812789fc606be1b3b16908db13fc7a9adf7ca72641f84d75b47069d3d7f0')
    expect(hex(keccak256(utf8('abc')))).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45')
  })

  it('matches @noble/hashes across block boundaries', () => {
    for (const len of [1, 31, 32, 64, 135, 136, 137, 200, 272, 273, 500]) {
      const input = Uint8Array.from({ length: len }, (_, i) => (i * 31 + len) & 0xff)
      expect(hex(keccak256(input))).toBe(hex(keccak_256(input)))
    }
  })
})
