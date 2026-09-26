import 'server-only'

import { eq, StoreNotConfigured, supabase } from '../supabase'

// Saved cases in Supabase; every query is filtered by the signed-in owner. Table: supabase/cases.sql

export { StoreNotConfigured }

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

const rest = supabase
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
