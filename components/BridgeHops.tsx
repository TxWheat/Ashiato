'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, ExternalLink, Plus, Shuffle } from 'lucide-react'
import { CrossChainHop, chainDisplay, hopTxUrl } from '@/lib/bridges/types'
import { fmtAmount } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

interface Props {
  /** The wallet that sent into the swap service */
  sender: string
  serviceName: string
  /** Transactions from the sender into the service (to find its orders) */
  txids: string[]
  /** Destination addresses already on the graph */
  onGraph: Set<string>
  onAdd: (hop: CrossChainHop) => void
}

const norm = (h: string) => h.toLowerCase().replace(/^0x/, '')
const when = (t?: number) => (t ? new Date(t * 1000).toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Where money sent into a cross-chain swap service came out, from the service's own order records */
export default function BridgeHops({ sender, serviceName, txids, onGraph, onAdd }: Props) {
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
  const matched = (hops ?? []).filter(h => ours.has(norm(h.fromHash)))
  const others = (hops ?? []).filter(h => !ours.has(norm(h.fromHash)))

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
      {matched.map(h => <Hop key={h.orderId} h={h} onGraph={onGraph} onAdd={onAdd} />)}
      {others.length > 0 && (
        <div>
          <button onClick={() => setShowOthers(v => !v)} className="text-faint hover:text-fg underline underline-offset-2">
            {showOthers ? 'Hide' : 'Show'} {others.length} other Bridgers swap{others.length === 1 ? '' : 's'} from this wallet
          </button>
          {showOthers && <div className="mt-2 space-y-2">{others.map(h => <Hop key={h.orderId} h={h} onGraph={onGraph} onAdd={onAdd} />)}</div>}
        </div>
      )}
    </div>
  )
}

function Hop({ h, onGraph, onAdd }: { h: CrossChainHop; onGraph: Set<string>; onAdd: (h: CrossChainHop) => void }) {
  const inUrl = hopTxUrl(h.fromChainName, h.fromHash)
  const outUrl = h.toHash ? hopTxUrl(h.toChainName, h.toHash) : undefined
  const added = onGraph.has(h.toAddress)
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
        {h.time ? ` · ${when(h.time)}` : ''} · <span className={/success|complete|finish|receive/i.test(h.status) ? 'text-green-500' : 'text-amber-500'}>{h.status}</span>
      </div>
      <div className="flex items-center gap-3 text-faint">
        {inUrl && <a href={inUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">Sent tx {truncate(h.fromHash, 5)} <ExternalLink size={9} /></a>}
        {outUrl ? (
          <a href={outUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-fg">Received tx {truncate(h.toHash!, 5)} <ExternalLink size={9} /></a>
        ) : <span>{h.toHash ? `Received tx ${truncate(h.toHash, 5)}` : 'Not paid out yet'}</span>}
        <button onClick={() => onAdd(h)} disabled={added || !h.toChain}
          title={h.toChain ? 'Put the destination on the graph and keep tracing there' : `${chainDisplay(h.toChainName)} isn't traceable in Ashiato yet`}
          className="ml-auto inline-flex items-center gap-1 h-6 px-2 whitespace-nowrap text-[10px] font-medium bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-40">
          <Plus size={10} /> {added ? 'On graph' : 'Add to graph'}
        </button>
      </div>
    </div>
  )
}
