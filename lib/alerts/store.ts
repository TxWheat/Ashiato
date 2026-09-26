import 'server-only'
import { eq, supabase } from '../supabase'
import type { AlertEvent } from './detect'

// Watched addresses and their alerts, per wallet (Supabase tables: watches, alerts)

export interface WatchRow {
  id: string
  wallet: string
  chain: string
  address: string
  label: string | null
  last_seen: number
  checked_at: string | null
  created_at: string
}

export interface AlertRow extends Omit<AlertEvent, 'counterpartyLabel'> {
  id: string
  wallet: string
  watch_id: string
  chain: string
  address: string
  label: string | null
  counterparty_label: string | null
  read: boolean
  created_at: string
}

export function watchesOf(wallet: string): Promise<WatchRow[]> {
  return supabase(`watches?wallet=${eq(wallet)}&select=*&order=created_at.desc&limit=100`)
}

/** Watches not checked since `before`, oldest first (for the scheduled check) */
export function staleWatches(before: Date, limit: number, wallet?: string): Promise<WatchRow[]> {
  const who = wallet ? `wallet=${eq(wallet)}&` : ''
  return supabase(`watches?${who}or=(checked_at.is.null,checked_at.lt.${encodeURIComponent(before.toISOString())})&select=*&order=checked_at.asc.nullsfirst&limit=${limit}`)
}

export async function addWatch(row: Pick<WatchRow, 'wallet' | 'chain' | 'address' | 'label' | 'last_seen'>): Promise<WatchRow> {
  const rows = await supabase<WatchRow[]>('watches?on_conflict=wallet,chain,address', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ ...row, checked_at: new Date().toISOString() }),
  })
  return rows[0]
}

export async function removeWatch(wallet: string, id: string) {
  await supabase(`watches?wallet=${eq(wallet)}&id=${eq(id)}`, { method: 'DELETE' })
}

export async function markChecked(id: string, lastSeen: number) {
  await supabase(`watches?id=${eq(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen: lastSeen, checked_at: new Date().toISOString() }),
  })
}

export async function addAlerts(watch: WatchRow, events: AlertEvent[]) {
  if (!events.length) return
  await supabase('alerts?on_conflict=watch_id,txid,direction,asset', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(events.map(e => ({
      wallet: watch.wallet, watch_id: watch.id, chain: watch.chain, address: watch.address, label: watch.label,
      txid: e.txid, time: e.time, direction: e.direction, amount: e.amount, asset: e.asset,
      counterparty: e.counterparty, counterparty_label: e.counterpartyLabel ?? null, urgent: e.urgent,
    }))),
  })
}

export function alertsOf(wallet: string, limit = 50): Promise<AlertRow[]> {
  return supabase(`alerts?wallet=${eq(wallet)}&select=*&order=time.desc&limit=${limit}`)
}

export async function markRead(wallet: string) {
  await supabase(`alerts?wallet=${eq(wallet)}&read=is.false`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ read: true }),
  })
}
