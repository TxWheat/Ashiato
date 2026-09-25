import 'server-only'

// Saved cases in Supabase (Postgres via its REST API). Server-side only, with the service
// role key; every query is filtered by the signed-in owner. Table: supabase/cases.sql

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export class StoreNotConfigured extends Error {
  constructor() {
    super('Case storage is not set up on this server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
}

export interface CaseMetaRow {
  id: string
  name: string
  origin_address: string | null
  origin_chain: string | null
  origin_kind: string | null
  addresses: number
  created_at: string
  updated_at: string
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!URL_ || !KEY) throw new StoreNotConfigured()
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    // New secret keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs also as a bearer token
    headers: { apikey: KEY, ...(KEY.startsWith('eyJ') ? { authorization: `Bearer ${KEY}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Case storage error (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`
const META = 'id,name,origin_address,origin_chain,origin_kind,addresses,created_at,updated_at'

export function listCases(owner: string): Promise<CaseMetaRow[]> {
  return rest(`cases?owner=${eq(owner)}&select=${META}&order=updated_at.desc&limit=500`)
}

export async function getCase(owner: string, id: string): Promise<(CaseMetaRow & { data: string }) | null> {
  const rows = await rest<(CaseMetaRow & { data: string })[]>(`cases?owner=${eq(owner)}&id=${eq(id)}&select=${META},data`)
  return rows[0] ?? null
}

export async function putCase(owner: string, row: { id: string; name: string; origin_address?: string; origin_chain?: string; origin_kind?: string; addresses: number; data: string }) {
  await rest('cases?on_conflict=owner,id', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, owner, updated_at: new Date().toISOString() }),
  })
}

export async function deleteCase(owner: string, id: string) {
  await rest(`cases?owner=${eq(owner)}&id=${eq(id)}`, { method: 'DELETE' })
}
