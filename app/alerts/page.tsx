'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { Bell, ExternalLink, Trash2 } from 'lucide-react'
import SiteNav from '@/components/SiteNav'
import { useAuth } from '@/components/Providers'
import { ago, alertText, useAlerts } from '@/components/AlertsBell'
import { detectChain, truncate } from '@/lib/detect-chain'
import { explorerTxUrl } from '@/lib/format'
import type { Chain } from '@/lib/types'

interface Watch { id: string; chain: string; address: string; label: string | null; checked_at: string | null; created_at: string }

/** Watched addresses and every alert (Pro) */
export default function AlertsPage() {
  const { address: user, signIn } = useAuth()
  const { alerts, load: loadAlerts } = useAlerts()
  const [watches, setWatches] = useState<Watch[] | null>(null)
  const [draft, setDraft] = useState({ address: '', label: '' })
  const [error, setError] = useState<{ text: string; upgrade?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadWatches = useCallback(async () => {
    const res = await fetch('/api/watches').catch(() => null)
    setWatches(res?.ok ? (await res.json()).watches : [])
  }, [])
  useEffect(() => { if (user) loadWatches() }, [user, loadWatches])

  const add = async () => {
    const address = draft.address.trim()
    const chain = detectChain(address)
    if (!chain) return setError({ text: 'Paste a Bitcoin, Ethereum or Tron address' })
    setBusy(true)
    setError(null)
    const res = await fetch('/api/watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain, address, label: draft.label }) }).catch(() => null)
    const body = await res?.json().catch(() => ({})) ?? {}
    setBusy(false)
    if (!res?.ok) return setError({ text: body.error ?? 'Could not add the address', upgrade: res?.status === 402 })
    setDraft({ address: '', label: '' })
    loadWatches()
  }

  const remove = async (id: string) => {
    setWatches(w => w?.filter(x => x.id !== id) ?? null)
    await fetch(`/api/watches?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <SiteNav />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-10 py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-tight text-fg">Alerts</h1>
          <p className="text-sm text-muted max-w-2xl">
            Watch a scammer&apos;s address and hear the moment money moves, above all when it reaches an exchange, while there is still time to ask the exchange to freeze it.
            Addresses are checked every few minutes while Ashiato is open and once a day otherwise.
          </p>
        </div>

        {user === undefined ? <p className="text-xs text-faint">Loading…</p> : !user ? (
          <button onClick={() => signIn()} className="h-10 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg">Sign in</button>
        ) : (
          <>
            <section className="border border-line p-5 space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg"><Bell size={14} /> Watched addresses</h2>
              <div className="flex flex-wrap gap-2">
                <input value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} placeholder="Address to watch" aria-label="Address to watch"
                  className="flex-1 min-w-64 h-9 px-3 bg-panel border border-line focus:border-accent font-mono text-xs text-fg outline-none" />
                <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Name (optional), e.g. Scammer wallet 1" aria-label="Name" maxLength={80}
                  className="w-64 h-9 px-3 bg-panel border border-line focus:border-accent text-xs text-fg outline-none" />
                <button onClick={add} disabled={busy || !draft.address.trim()} className="h-9 px-4 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
                  {busy ? 'Adding…' : 'Watch'}
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error.text}{error.upgrade && <> · <Link href="/pricing" className="underline underline-offset-2 hover:text-fg">Alerts are part of Pro</Link></>}</p>}
              {watches === null ? <p className="text-xs text-faint">Loading…</p> : watches.length === 0 ? (
                <p className="text-xs text-faint">Nothing watched yet. Add an address here, or use the bell in any address&apos;s menu on the graph.</p>
              ) : (
                <ul className="divide-y divide-line border-t border-line">
                  {watches.map(w => (
                    <li key={w.id} className="flex items-center gap-3 py-2 text-xs">
                      <span className="text-faint w-10">{w.chain.toUpperCase()}</span>
                      <Link href={`/trace?address=${encodeURIComponent(w.address)}&chain=${w.chain}`} className="font-mono text-fg hover:text-accent">{truncate(w.address, 8)}</Link>
                      {w.label && <span className="text-muted truncate">{w.label}</span>}
                      <span className="ml-auto text-faint">{w.checked_at ? `checked ${ago(Date.parse(w.checked_at) / 1000)}` : 'not checked yet'}</span>
                      <button onClick={() => remove(w.id)} title="Stop watching" aria-label="Stop watching" className="p-1 text-faint hover:text-red-500"><Trash2 size={13} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-fg">All alerts</h2>
                <button onClick={loadAlerts} className="text-xs text-muted hover:text-fg underline underline-offset-2">Check now</button>
              </div>
              {alerts.length === 0 ? <p className="text-xs text-faint">No alerts yet.</p> : (
                <ul className="divide-y divide-line border border-line">
                  {alerts.map(a => (
                    <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <span className={clsx('w-2 h-2 rounded-full shrink-0', a.urgent ? 'bg-red-500' : a.direction === 'out' ? 'bg-amber-500' : 'bg-green-500')} aria-hidden />
                      <span className={clsx(a.urgent ? 'text-red-500 font-medium' : 'text-fg')}>{a.urgent && 'Reached an exchange: '}{alertText(a)}</span>
                      <span className="ml-auto text-faint whitespace-nowrap">{new Date(a.time * 1000).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                      <a href={explorerTxUrl(a.txid, a.chain as Chain)} target="_blank" rel="noopener noreferrer" title="View the transaction" aria-label="View the transaction" className="text-faint hover:text-fg"><ExternalLink size={12} /></a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
