import 'server-only'

// Supabase (Postgres via its REST API), server-side only with the service role key.

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export class StoreNotConfigured extends Error {
  constructor() {
    super('Storage is not set up on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
}

export const storeConfigured = () => !!(URL_ && KEY)

export async function supabase<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!URL_ || !KEY) throw new StoreNotConfigured()
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    // New secret keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs also as a bearer token
    headers: { apikey: KEY, ...(KEY.startsWith('eyJ') ? { authorization: `Bearer ${KEY}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Storage error (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const eq = (v: string) => `eq.${encodeURIComponent(v)}`
