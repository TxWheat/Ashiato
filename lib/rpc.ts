import 'server-only'

// Minimal batched Ethereum JSON-RPC client. Used for ENS names and single-tx
// lookups so they don't spend the Etherscan rate limit.

export const RPC_URL = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'

export interface RpcCall {
  method: string
  params: unknown[]
}

async function post(body: unknown): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Ethereum RPC returned ${res.status}`)
  return res.json()
}

/**
 * Batched calls. Public nodes sometimes reject a batch or error on single
 * items (rate limits, batch size caps), so failed items are retried one by one.
 */
export async function rpcBatch<T = unknown>(calls: RpcCall[]): Promise<(T | undefined)[]> {
  if (!calls.length) return []
  const out: (T | undefined)[] = new Array(calls.length)
  const failed = new Set(calls.map((_, i) => i))
  try {
    const json = await post(calls.map((c, id) => ({ jsonrpc: '2.0', id, method: c.method, params: c.params })))
    for (const r of Array.isArray(json) ? (json as { id: number; result?: T; error?: unknown }[]) : []) {
      if (r && !r.error && typeof r.id === 'number') {
        out[r.id] = r.result
        failed.delete(r.id)
      }
    }
  } catch {
    // fall through to single calls
  }
  for (const i of failed) {
    try {
      const r = (await post({ jsonrpc: '2.0', id: i, method: calls[i].method, params: calls[i].params })) as { result?: T }
      out[i] = r?.result
    } catch {
      out[i] = undefined
    }
  }
  return out
}

export const ethCall = (to: string, data: string): RpcCall => ({ method: 'eth_call', params: [{ to, data }, 'latest'] })
