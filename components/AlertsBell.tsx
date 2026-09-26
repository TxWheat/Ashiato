'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { Bell } from 'lucide-react'
import { useAuth } from './Providers'
import { truncate } from '@/lib/detect-chain'

export interface AlertItem {
  id: string
  chain: string
  address: string
  label: string | null
  txid: string
  time: number
  direction: 'in' | 'out'
  amount: number
  asset: string
  counterparty: string
  counterparty_label: string | null
  urgent: boolean
  read: boolean
}

const POLL_MS = 5 * 60_000

export const ago = (t: number) => {
  const s = Date.now() / 1000 - t
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`
}
const amt = (n: number) => n.toLocaleString('en-NZ', { maximumSignificantDigits: 6 })

/** One alert in words: "4.9 ETH left Scammer wallet → Binance deposit" */
export function alertText(a: AlertItem) {
  const who = a.label ?? truncate(a.address, 5)
  const other = a.counterparty_label ?? truncate(a.counterparty, 5)
  return a.direction === 'out' ? `${amt(a.amount)} ${a.asset} left ${who} → ${other}` : `${amt(a.amount)} ${a.asset} arrived at ${who} from ${other}`
}

/** Checks for new transfers at your watched addresses while the app is open */
export function useAlerts() {
  const { address } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [unread, setUnread] = useState(0)
  const load = useCallback(async () => {
    const res = await fetch('/api/alerts').catch(() => null)
    const body = res?.ok ? await res.json() : null
    if (body) { setAlerts(body.alerts); setUnread(body.unread) }
  }, [])
  useEffect(() => {
    if (!address) return
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    return () => clearInterval(t)
  }, [address, load])
  const markRead = useCallback(async () => {
    setUnread(0)
    setAlerts(a => a.map(x => ({ ...x, read: true })))
    await fetch('/api/alerts', { method: 'POST' }).catch(() => {})
  }, [])
  return { alerts, unread, load, markRead }
}

export default function AlertsBell() {
  const { address } = useAuth()
  const { alerts, unread, markRead } = useAlerts()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])
  if (!address) return null
  const urgent = alerts.some(a => !a.read && a.urgent)
  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen(o => !o); if (!open && unread) markRead() }} title="Alerts from watched addresses" aria-label={`Alerts${unread ? `, ${unread} new` : ''}`} aria-expanded={open}
        className="relative grid place-items-center w-9 h-9 border border-line text-faint hover:text-fg">
        <Bell size={14} />
        {unread > 0 && (
          <span className={clsx('absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 grid place-items-center text-[9px] font-semibold text-white', urgent ? 'bg-red-500' : 'bg-accent')}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-panel border border-line shadow-xl text-xs">
          <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-faint border-b border-line">Alerts</div>
          {alerts.length === 0 ? (
            <p className="px-3 py-3 text-muted">No alerts yet. Watch an address (the bell in its menu) to hear when funds move.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {alerts.slice(0, 8).map(a => (
                <li key={a.id}>
                  <Link href={`/trace?address=${encodeURIComponent(a.address)}&chain=${a.chain}`} onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-raised border-b border-line">
                    <div className={clsx('leading-snug', a.urgent ? 'text-red-500 font-medium' : 'text-fg')}>{a.urgent && 'Reached an exchange: '}{alertText(a)}</div>
                    <div className="text-faint">{ago(a.time)} · {a.chain.toUpperCase()}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/alerts" onClick={() => setOpen(false)} className="block px-3 py-2 text-muted hover:text-fg hover:bg-raised">All alerts and watched addresses →</Link>
        </div>
      )}
    </div>
  )
}
