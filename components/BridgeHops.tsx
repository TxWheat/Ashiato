'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, Plus, Shuffle, X } from 'lucide-react'
import { CrossChainHop, chainDisplay, hopTxUrl, statusOk, statusText } from '@/lib/bridges/types'
import { fmtAmount } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

interface Props {
  /** The wallet that sent into the swap service */
  sender: string
  serviceName: string
  /** Transactions from the sender into the service (to find its orders), with their on-chain times */
  txids: string[]
  txTimes?: Record<string, number>
  /** Order ids already drawn on the graph */
  added: Set<string>
  /** `matched`: the swap is one of this link's transactions (else another swap by the same wallet) */
  onAdd: (hop: CrossChainHop, matched: boolean) => void
  onRemove: (orderId: string) => void
}

const norm = (h: string) => h.toLowerCase().replace(/^0x/, '')
const when = (t?: number) => (t ? new Date(t * 1000).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Where money sent into a cross-chain swap service came out, from the service's own order records */
export default function BridgeHops({ sender, serviceName, txids, txTimes = {}, added, onAdd, onRemove }: Props) {
  const [hops, setHops] = useState<CrossChainHop[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showOthers, setShowOthers] = useState(false)

  useEffect(() => {
    setHops(null)
    setError(null)
    fetch(`/api/bridges/${encodeURIComponent(sender)}`)
      .then(async r => {
        const b = await r.json()
        if (!r.ok) setError(b.error ?? 'Lookup failed')
        setHops(b.hops ?? [])
      })
      .catch(() => {
        setError('Lookup failed')
        setHops([])
      })
  }, [sender])

  const ours = new Set(txids.map(norm))
  const times = Object.fromEntries(Object.entries(txTimes).map(([k, v]) => [norm(k), v]))
  const matched = (hops ?? []).filter(h => ours.has(norm(h.fromHash))).map(h => ({ ...h, time: times[norm(h.fromHash)] }))
  const others = (hops ?? []).filter(h => !ours.has(norm(h.fromHash)))
  // Other swaps to the same destination (e.g. from another chain) are part of the same story
  const dests = new Set(matched.map(h => h.toAddress))
  const related = others.filter(h => dests.has(h.toAddress))
  const unrelated = others.filter(h => !dests.has(h.toAddress))
  const relatedTotal = related.length ? [...matched, ...related].reduce((m, h) => m.set(h.toAsset, (m.get(h.toAsset) ?? 0) + h.toAmount), new Map<string, number>()) : null

  return (
    <div className="border border-orange-500/50 bg-orange-500/5 p-3 space-y-2 text-[11px]">
      <div className="flex items-center gap-1.5 font-medium text-fg">
        <Shuffle size={12} className="text-orange-500" /> Cross-chain swap via {serviceName}
      </div>
      {hops === null && <p className="text-faint">Asking Bridgers where it went…</p>}
      {error && <p className="text-red-500">{error}</p>}
      {hops && !error && !matched.length && (
        <p className="text-faint">
          No Bridgers order matches these transactions{others.length ? '' : ', and this wallet has no other Bridgers swaps'}. It may have used a different service behind the same contract.
        </p>
      )}
      {matched.map(h => <Hop key={h.orderId} h={h} added={added} onRemove={onRemove} onAdd={x => onAdd(x, true)} />)}
      {related.length > 0 && (
        <div className="space-y-2">
          <div className="text-faint pt-1">
            The same wallet sent <b className="text-fg font-medium">{related.length} more swap{related.length === 1 ? '' : 's'}</b> to the same destination
            {related.some(h => h.fromChainName !== matched[0]?.fromChainName) ? ' from another chain' : ''}
            {relatedTotal && <> · total received <b className="text-fg font-medium font-mono">{[...relatedTotal].map(([a, v]) => fmtAmount(v, a, 2)).join(' + ')}</b></>}
          </div>
          {related.map(h => <Hop key={h.orderId} h={h} added={added} onRemove={onRemove} onAdd={x => onAdd(x, false)} />)}
        </div>
      )}
      {unrelated.length > 0 && (
        <div>
          <button onClick={() => setShowOthers(v => !v)} className="text-faint hover:text-fg underline underline-offset-2">
            {showOthers ? 'Hide' : 'Show'} {unrelated.length} other Bridgers swap{unrelated.length === 1 ? '' : 's'} from this wallet
          </button>
          {showOthers && <div className="mt-2 space-y-2">{unrelated.map(h => <Hop key={h.orderId} h={h} added={added} onRemove={onRemove} onAdd={x => onAdd(x, false)} />)}</div>}
        </div>
      )}
    </div>
  )
}

function Hop({ h, added: addedIds, onAdd, onRemove }: { h: CrossChainHop; added: Set<string>; onAdd: (h: CrossChainHop) => void; onRemove: (orderId: string) => void }) {
  const inUrl = h.depositUrl || hopTxUrl(h.fromChainName, h.fromHash)
  const outUrl = h.toHash ? h.receiveUrl || hopTxUrl(h.toChainName, h.toHash) : undefined
  const added = addedIds.has(h.orderId)
  return (
    <div className="border border-line bg-bg p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-fg">{fmtAmount(h.fromAmount, h.fromAsset, 6)}</span>
        <span className="text-faint">{chainDisplay(h.fromChainName)}</span>
        <ArrowRight size={11} className="text-orange-500" />
        <span className="font-mono text-fg">{fmtAmount(h.toAmount, h.toAsset, 6)}</span>
        <span className="text-faint">{chainDisplay(h.toChainName)}</span>
      </div>
      <div className="text-faint">
        To <span className="font-mono text-fg" title={h.toAddress}>{truncate(h.toAddress, 8)}</span>
        {h.time ? ` · ${when(h.time)}` : h.createdText ? ` · ${h.createdText} (Bridgers time)` : ''} · <span className={statusOk(h.status) ? 'text-green-500' : 'text-amber-500'}>{statusText(h.status)}</span>
        {h.refundHash && <> · refunded {h.refundUrl ? <a href={h.refundUrl} target="_blank" rel="noopener noreferrer" className="underline">{truncate(h.refundHash, 5)}</a> : truncate(h.refundHash, 5)}</>}
      </div>
      <div className="flex items-center gap-3 text-faint">
        {inUrl && <a href={inUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">Sent tx {truncate(h.fromHash, 5)} <ExternalLink size={9} /></a>}
        {outUrl ? (
          <a href={outUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">Received tx {truncate(h.toHash!, 5)} <ExternalLink size={9} /></a>
        ) : <span>{h.toHash ? `Received tx ${truncate(h.toHash, 5)}` : 'Not paid out yet'}</span>}
        {added ? (
          <button onClick={() => onRemove(h.orderId)} title="Take this swap's line off the graph"
            className="ml-auto inline-flex items-center gap-1 h-6 px-2 whitespace-nowrap text-[10px] font-medium bg-raised hover:bg-line text-fg">
            <X size={10} /> Remove
          </button>
        ) : (
          <button onClick={() => onAdd(h)} disabled={!h.toChain}
            title={h.toChain ? 'Put the destination on the graph and keep tracing there' : `${chainDisplay(h.toChainName)} isn't traceable in Ashiato yet`}
            className="ml-auto inline-flex items-center gap-1 h-6 px-2 whitespace-nowrap text-[10px] font-medium bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40">
            <Plus size={10} /> Add to graph
          </button>
        )}
      </div>
    </div>
  )
}
