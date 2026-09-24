// Keccak-256 (the pre-NIST variant Ethereum uses), dependency-free.
// Only used for ENS namehashes (a few hundred small inputs), so it favours
// clarity over speed: 64-bit lanes as BigInt. Verified against published
// vectors and @noble/hashes in tests/keccak.test.ts.

const MASK = (1n << 64n) - 1n
const RATE = 136 // bytes, for a 256-bit output

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

// Rotation offsets, indexed by lane x + 5y
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]

function rotl(x: bigint, n: number): bigint {
  if (n === 0) return x
  const b = BigInt(n)
  return ((x << b) | (x >> (64n - b))) & MASK
}

function keccakF(s: bigint[]) {
  const C = new Array<bigint>(5)
  const B = new Array<bigint>(25)
  for (let round = 0; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1)
      for (let y = 0; y < 25; y += 5) s[x + y] ^= D
    }
    // ρ and π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y])
    }
    // χ
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) s[x + y] = B[x + y] ^ (~B[((x + 1) % 5) + y] & MASK & B[((x + 2) % 5) + y])
    }
    // ι
    s[0] ^= RC[round]
  }
}

export function keccak256(input: Uint8Array): Uint8Array {
  // Keccak padding: 0x01 … 0x80 (not SHA-3's 0x06)
  const padLen = RATE - (input.length % RATE)
  const msg = new Uint8Array(input.length + padLen)
  msg.set(input)
  msg[input.length] ^= 0x01
  msg[msg.length - 1] ^= 0x80

  const s = new Array<bigint>(25).fill(0n)
  for (let off = 0; off < msg.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b])
      s[i] ^= lane
    }
    keccakF(s)
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 4; i++) {
    let lane = s[i]
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn)
      lane >>= 8n
    }
  }
  return out
}
