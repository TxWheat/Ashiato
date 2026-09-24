import 'server-only'
import { keccak256 } from './keccak'
import { ethCall, rpcBatch } from './rpc'

// ENS primary-name lookup over plain JSON-RPC (batched, 4 round trips for any
// number of addresses). Every name is forward-verified: anyone can set their
// reverse record to "binance.eth", so a name only counts if it resolves back
// to the same address.

const REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e'
const SEL = { resolver: '0178b8bf', name: '691f3431', addr: '3b3b57de' }
const TTL_MS = 60 * 60 * 1000
const MAX_PER_CALL = 80

const cache = new Map<string, { name: string | null; expires: number }>()

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(h: string): Uint8Array {
  const s = h.replace(/^0x/, '')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** EIP-137 namehash */
export function namehash(name: string): string {
  let node: Uint8Array = new Uint8Array(32)
  if (name) {
    for (const label of name.split('.').reverse()) {
      const labelHash = keccak256(new TextEncoder().encode(label))
      const buf = new Uint8Array(64)
      buf.set(node, 0)
      buf.set(labelHash, 32)
      node = keccak256(buf)
    }
  }
  return '0x' + hex(node)
}

function word(result: string, index = 0): string {
  return result.replace(/^0x/, '').slice(index * 64, index * 64 + 64)
}

function decodeAddress(result: string | undefined): string | null {
  if (!result || result.length < 66) return null
  const a = '0x' + word(result).slice(24)
  return /^0x0{40}$/.test(a) ? null : a
}

function decodeString(result: string | undefined): string | null {
  if (!result || result.length < 130) return null
  const offset = parseInt(word(result, 0), 16) / 32
  const len = parseInt(word(result, offset), 16)
  if (!len || len > 255) return null
  const dataHex = result.replace(/^0x/, '').slice((offset + 1) * 64, (offset + 1) * 64 + len * 2)
  return new TextDecoder().decode(fromHex(dataHex))
}

function batchCall(calls: { to: string; data: string }[]): Promise<(string | undefined)[]> {
  return rpcBatch<string>(calls.map(c => ethCall(c.to, c.data)))
}

/** Only plain lowercase ASCII names; anything needing ENSIP-15 normalisation is skipped */
function plausible(name: string): boolean {
  return /^[a-z0-9-_]+(\.[a-z0-9-_]+)*\.[a-z]{2,}$/.test(name) && name.length <= 100
}

/** address (lowercase) → verified primary ENS name. Missing entries have no name. */
export async function lookupEnsNames(addresses: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const result = new Map<string, string>()
  const todo: string[] = []
  for (const raw of new Set(addresses.map(a => a.toLowerCase()))) {
    const hit = cache.get(raw)
    if (hit && hit.expires > now) {
      if (hit.name) result.set(raw, hit.name)
    } else if (/^0x[0-9a-f]{40}$/.test(raw)) {
      todo.push(raw)
    }
  }
  const batch = todo.slice(0, MAX_PER_CALL)
  if (!batch.length) return result

  try {
    // 1. reverse node → resolver
    const reverseNodes = batch.map(a => namehash(`${a.slice(2)}.addr.reverse`))
    const resolvers = (await batchCall(reverseNodes.map(n => ({ to: REGISTRY, data: `0x${SEL.resolver}${n.slice(2)}` })))).map(decodeAddress)

    // 2. resolver.name(reverseNode)
    const withResolver = batch.map((a, i) => ({ a, i, r: resolvers[i] })).filter(x => x.r)
    const names = (await batchCall(withResolver.map(x => ({ to: x.r!, data: `0x${SEL.name}${reverseNodes[x.i].slice(2)}` })))).map(decodeString)
    const candidates = withResolver.map((x, k) => ({ a: x.a, name: names[k] })).filter(x => x.name && plausible(x.name)) as { a: string; name: string }[]

    // 3. forward: name → resolver → addr(name) must equal the address
    const fwdNodes = candidates.map(c => namehash(c.name))
    const fwdResolvers = (await batchCall(fwdNodes.map(n => ({ to: REGISTRY, data: `0x${SEL.resolver}${n.slice(2)}` })))).map(decodeAddress)
    const withFwd = candidates.map((c, i) => ({ ...c, node: fwdNodes[i], r: fwdResolvers[i] })).filter(c => c.r)
    const addrs = (await batchCall(withFwd.map(c => ({ to: c.r!, data: `0x${SEL.addr}${c.node.slice(2)}` })))).map(decodeAddress)

    const verified = new Map<string, string>()
    withFwd.forEach((c, i) => {
      if (addrs[i] === c.a) verified.set(c.a, c.name)
    })
    for (const a of batch) {
      const name = verified.get(a) ?? null
      cache.set(a, { name, expires: now + TTL_MS })
      if (name) result.set(a, name)
    }
  } catch {
    // ENS is a nice-to-have; tracing continues without names
  }
  return result
}
