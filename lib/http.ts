import 'server-only'

// Upstream fetch helper: in-memory TTL cache, per-host throttle, and retry with
// back-off on 429/5xx. Free APIs (Blockstream, mempool.space, Etherscan) rate
// limit aggressively, and investigators click Expand/Follow a lot.

const MAX_ENTRIES = 1000
const cache = new Map<string, { expires: number; body: unknown }>()
const lastCall = new Map<string, number>()
const MIN_GAP_MS: Record<string, number> = {
  'api.etherscan.io': 220, // free tier: 5 calls/s
  'blockstream.info': 120,
  'mempool.space': 120,
}

export class UpstreamError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function throttle(host: string) {
  const gap = MIN_GAP_MS[host] ?? 100
  const now = Date.now()
  const next = Math.max(now, (lastCall.get(host) ?? 0) + gap)
  lastCall.set(host, next)
  if (next > now) await new Promise(r => setTimeout(r, next - now))
}

export async function fetchJson<T>(url: string, ttlSeconds = 60, retries = 3): Promise<T> {
  const hit = cache.get(url)
  if (hit && hit.expires > Date.now()) return hit.body as T

  const host = new URL(url).host
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host)
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new UpstreamError(`${host} returned ${res.status}`, res.status)
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      if (!res.ok) throw new UpstreamError(`${host} returned ${res.status}`, res.status)
      const text = await res.text()
      let body: T
      try {
        body = JSON.parse(text) as T
      } catch {
        throw new UpstreamError(`${host} returned non-JSON: ${text.slice(0, 80)}`, 502)
      }
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!)
      cache.set(url, { expires: Date.now() + ttlSeconds * 1000, body })
      return body
    } catch (e) {
      if (e instanceof UpstreamError && e.status < 500 && e.status !== 429) throw e
      lastErr = e
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${host}`)
}
