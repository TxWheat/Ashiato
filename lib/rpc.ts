import 'server-only'

// Minimal batched Ethereum JSON-RPC client. Used for ENS names and single-tx
// lookups so they don't spend the Etherscan rate limit.

export const RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'

export interface RpcCall {
  method: string
  params: unknown[]
}

export async function rpcBatch<T = unknown>(calls: RpcCall[]): Promise<(T | undefined)[]> {
  if (!calls.length) return []
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params }))
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Ethereum RPC returned ${res.status}`)
  const json = (await res.json()) as { id: number; result?: T }[]
  const out: (T | undefined)[] = new Array(calls.length)
  for (const r of Array.isArray(json) ? json : []) out[r.id] = r.result
  return out
}

export const ethCall = (to: string, data: string): RpcCall => ({ method: 'eth_call', params: [{ to, data }, 'latest'] })
