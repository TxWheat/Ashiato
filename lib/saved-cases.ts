'use client'

import { CaseFile } from './export'

/**
 * Saved cases. Signed in: in your account (server → Supabase, keyed by your wallet
 * address, compressed). Signed out: in this browser (IndexedDB: a case with its loaded
 * transactions can be several MB, more than localStorage allows).
 */
const DB = 'cryptotracer'
const STORE = 'cases'

export interface SavedCaseMeta {
  id: string
  name: string
  savedAt: string
  createdAt?: string
  origin: CaseFile['origin']
  originKind?: CaseFile['originKind']
  addresses: number
}

interface Row extends SavedCaseMeta {
  data: CaseFile
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser cannot store charts (IndexedDB unavailable)'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open browser storage'))
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('Browser storage error'))
      tx.onabort = () => reject(tx.error ?? new Error('Browser storage is full'))
    })
  } finally {
    db.close()
  }
}

async function saveCaseLocal(id: string, name: string, data: CaseFile): Promise<void> {
  const row: Row = { id, name, savedAt: data.savedAt, origin: data.origin, originKind: data.originKind, addresses: data.visible.length, data }
  await run('readwrite', s => s.put(row))
}

async function listCasesLocal(): Promise<SavedCaseMeta[]> {
  const rows = await run<Row[]>('readonly', s => s.getAll() as IDBRequest<Row[]>)
  return rows
    .map(({ data: _data, ...meta }) => meta) // eslint-disable-line @typescript-eslint/no-unused-vars
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

async function getCaseLocal(id: string): Promise<{ name: string; data: CaseFile } | undefined> {
  const row = await run<Row | undefined>('readonly', s => s.get(id) as IDBRequest<Row | undefined>)
  return row ? { name: row.name, data: row.data } : undefined
}

async function deleteCaseLocal(id: string): Promise<void> {
  await run('readwrite', s => s.delete(id))
}

export const newCaseId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ── Account storage ─────────────────────────────────────────────────────────

let account: string | null = null
let resolveReady: () => void
const ready = new Promise<void>(r => (resolveReady = r))
// Never hang if the sign-in check fails
if (typeof window !== 'undefined') setTimeout(() => resolveReady(), 4000)

/** Called by the sign-in provider once it knows who is signed in (null = nobody) */
export function setCaseAccount(address: string | null) {
  account = address
  resolveReady()
}
export const caseAccount = () => account

async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function gunzip(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body as T
}

interface CloudRow {
  id: string; name: string; origin_address: string | null; origin_chain: string | null; origin_kind: string | null
  addresses: number; created_at: string; updated_at: string; data?: string
}

const toMeta = (r: CloudRow): SavedCaseMeta => ({
  id: r.id, name: r.name, savedAt: r.updated_at, createdAt: r.created_at, addresses: r.addresses,
  origin: { address: r.origin_address ?? '', chain: (r.origin_chain ?? 'eth') as CaseFile['origin']['chain'] },
  originKind: (r.origin_kind ?? undefined) as CaseFile['originKind'],
})

async function saveCaseCloud(id: string, name: string, data: CaseFile) {
  await api(`/api/cases/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ name, origin: data.origin, originKind: data.originKind, addresses: data.visible.length, data: await gzip(JSON.stringify(data)) }),
  })
}

// ── Public API: account when signed in, else this browser ──────────────────

export async function saveCase(id: string, name: string, data: CaseFile): Promise<void> {
  await ready
  return account ? saveCaseCloud(id, name, data) : saveCaseLocal(id, name, data)
}

export async function listCases(): Promise<SavedCaseMeta[]> {
  await ready
  if (!account) return listCasesLocal()
  const { cases } = await api<{ cases: CloudRow[] }>('/api/cases')
  return cases.map(toMeta)
}

export async function getCase(id: string): Promise<{ name: string; data: CaseFile } | undefined> {
  await ready
  if (!account) return getCaseLocal(id)
  const res = await fetch(`/api/cases/${encodeURIComponent(id)}`)
  if (res.status === 404) return getCaseLocal(id) // a case still only in this browser
  const row: CloudRow & { error?: string } = await res.json()
  if (!res.ok || !row.data) throw new Error(row.error ?? 'Could not open the case')
  return { name: row.name, data: JSON.parse(await gunzip(row.data)) }
}

export async function deleteCase(id: string): Promise<void> {
  await ready
  if (account) await api(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE' })
  else await deleteCaseLocal(id)
}

/** Cases saved in this browser (whether or not you're signed in) */
export const listBrowserCases = () => listCasesLocal()
export const deleteBrowserCase = (id: string) => deleteCaseLocal(id)

/** Copy a case from this browser into your account (then remove the browser copy) */
export async function moveBrowserCaseToAccount(id: string): Promise<void> {
  if (!account) throw new Error('Sign in first')
  const c = await getCaseLocal(id)
  if (!c) return
  await saveCaseCloud(id, c.name, c.data)
  await deleteCaseLocal(id)
}
