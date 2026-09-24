'use client'

import { CaseFile } from './export'

/**
 * Charts saved in this browser (IndexedDB: a case with its loaded transactions can
 * be several MB, more than localStorage allows). Nothing leaves the machine.
 */
const DB = 'cryptotracer'
const STORE = 'cases'

export interface SavedCaseMeta {
  id: string
  name: string
  savedAt: string
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

export async function saveCase(id: string, name: string, data: CaseFile): Promise<void> {
  const row: Row = { id, name, savedAt: data.savedAt, origin: data.origin, originKind: data.originKind, addresses: data.visible.length, data }
  await run('readwrite', s => s.put(row))
}

export async function listCases(): Promise<SavedCaseMeta[]> {
  const rows = await run<Row[]>('readonly', s => s.getAll() as IDBRequest<Row[]>)
  return rows
    .map(({ data: _data, ...meta }) => meta) // eslint-disable-line @typescript-eslint/no-unused-vars
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function getCase(id: string): Promise<{ name: string; data: CaseFile } | undefined> {
  const row = await run<Row | undefined>('readonly', s => s.get(id) as IDBRequest<Row | undefined>)
  return row ? { name: row.name, data: row.data } : undefined
}

export async function deleteCase(id: string): Promise<void> {
  await run('readwrite', s => s.delete(id))
}

export const newCaseId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
