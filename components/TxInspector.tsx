'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { Copy, Check, ExternalLink, Plus, CheckCircle2, ArrowRightFromLine, ArrowLeftToLine, AlertTriangle } from 'lucide-react'
import { EntityLabel, RawTransaction, TxIO, TxLookup } from '@/lib/types'
import { ENTITY_STYLE, explorerTxUrl, fmtAmount, fmtDate } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

interface Props {
  lookup: TxLookup
  onGraph: Set<string>
  tracing: boolean
  nameOf: (a: string) => string | undefined
  labelOf: (a: string) => EntityLabel | undefined
  onAdd: (addresses: string[]) => void
  onOpen: (address: string) => void
  /** Follow one output (or, with no `to`, every non-change output) onward */
  onTraceOut: (tx: RawTransaction, to?: string) => void
  /** Walk one input (or every input) back to its source */
  onSourceIn: (tx: RawTransaction, input?: TxIO) => void
}

export default function TxInspector(p: Props) {
  const { lookup } = p
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(lookup.txid)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const Addr = ({ a }: { a: string }) => {
    const l = p.labelOf(a)
    const on = p.onGraph.has(a)
    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', l ? ENTITY_STYLE[l.type].dot : 'bg-line')} />
        <button onClick={() => p.onOpen(a)} className={clsx('truncate text-left text-[12px] text-fg hover:text-accent', !p.nameOf(a) && 'font-mono')} title={a}>
          {p.nameOf(a) ?? truncate(a, 8)}
        </button>
        <button onClick={() => !on && p.onAdd([a])} disabled={on} title={on ? 'On the graph' : 'Add to graph'}
          className={clsx('grid place-items-center w-6 h-6 flex-shrink-0 ml-auto', on ? 'text-accent' : 'bg-raised hover:bg-accent hover:text-accent-fg text-fg')}>
          {on ? <CheckCircle2 size={12} /> : <Plus size={12} />}
        </button>
      </div>
    )
  }

  const Btn = ({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) => (
    <button onClick={onClick} disabled={p.tracing}
      className={clsx('flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium disabled:opacity-40 flex-shrink-0', primary ? 'bg-accent hover:bg-accent-hover text-accent-fg' : 'bg-raised hover:bg-line text-fg')}>
      {children}
    </button>
  )

  const btc = lookup.chain === 'btc' ? lookup.transfers[0] : undefined

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-4 border-b border-line space-y-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider">
          <span className={clsx('w-1.5 h-1.5 rounded-full', lookup.chain === 'btc' ? 'bg-orange-500' : 'bg-violet-500')} />
          <span className="text-faint">{lookup.chain} transaction</span>
          {lookup.failed && <span className="px-1.5 py-0.5 bg-red-500/15 text-red-500">failed</span>}
          {btc?.coinjoin && <span className="px-1.5 py-0.5 bg-orange-500/15 text-orange-500">{btc.coinjoin.kind} CoinJoin</span>}
        </div>
        <div className="flex items-start gap-2">
          <code className="text-[11px] text-fg break-all leading-relaxed flex-1">{lookup.txid}</code>
          <button onClick={copy} title="Copy" className="text-faint hover:text-fg mt-0.5">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          <a href={explorerTxUrl(lookup.txid, lookup.chain)} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-fg mt-0.5" title="Open in block explorer"><ExternalLink size={13} /></a>
        </div>
        <div className="text-[11px] text-faint">{fmtDate(lookup.timestamp)}{btc?.fee !== undefined ? ` · fee ${fmtAmount(btc.fee, 'BTC', 8)}` : ''}</div>
        {!!lookup.warnings?.length && (
          <div className="text-[11px] text-yellow-600 space-y-0.5">
            {lookup.warnings.map((w, i) => <div key={i} className="flex gap-1.5"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />{w}</div>)}
          </div>
        )}
        {btc && (
          <div className="flex gap-1.5 pt-1">
            <Btn onClick={() => p.onSourceIn(btc)}><ArrowLeftToLine size={10} /> Source of all inputs</Btn>
            <Btn primary onClick={() => p.onTraceOut(btc)}>Trace all outputs <ArrowRightFromLine size={10} /></Btn>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {btc ? (
          <>
            <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider text-faint">Inputs · {btc.inputs.length}</div>
            {btc.isCoinbase && <p className="px-4 pb-2 text-[12px] text-faint">Newly mined coins (coinbase)</p>}
            {btc.inputs.map((i, k) => (
              <div key={k} className="flex items-center gap-3 px-4 py-2 border-b border-line/60">
                <Addr a={i.address} />
                <span className="font-mono text-[11px] text-muted whitespace-nowrap">{fmtAmount(i.amount, 'BTC', 8)}</span>
                <Btn onClick={() => p.onSourceIn(btc, i)}><ArrowLeftToLine size={10} /> Source</Btn>
              </div>
            ))}
            <div className="px-4 pt-4 pb-1.5 text-[10px] uppercase tracking-wider text-faint">Outputs · {btc.outputs.length}</div>
            {btc.outputs.map((o, k) => (
              <div key={k} className="px-4 py-2 border-b border-line/60">
                <div className="flex items-center gap-3">
                  <Addr a={o.address} />
                  <span className="font-mono text-[11px] text-fg whitespace-nowrap">{fmtAmount(o.amount, 'BTC', 8)}</span>
                  <Btn primary onClick={() => p.onTraceOut(btc, o.address)}>Trace <ArrowRightFromLine size={10} /></Btn>
                </div>
                <div className="mt-1 pl-4 flex gap-2 text-[10px]">
                  {o.isChange && <span className="px-1 bg-yellow-500/15 text-yellow-600" title={o.change?.reasons.join('; ')}>likely change {o.change ? `${Math.round(o.change.confidence * 100)}%` : ''}</span>}
                  {lookup.spentBy && <span className="text-faint">{lookup.spentBy[k] ? `spent in ${lookup.spentBy[k]!.slice(0, 10)}…` : 'unspent'}</span>}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider text-faint">Transfers in this transaction · {lookup.transfers.length}</div>
            {lookup.transfers.length === 0 && <p className="px-4 text-[12px] text-faint">No value moved.</p>}
            {lookup.transfers.map((t, k) => (
              <div key={k} className="px-4 py-3 border-b border-line/60 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13px] text-fg">{fmtAmount(t.outputs[0].amount, t.asset, 8)}</span>
                  <span className="text-[9px] px-1 bg-raised text-faint">{t.kind}</span>
                  <div className="ml-auto flex gap-1">
                    <Btn onClick={() => p.onSourceIn(t, t.inputs[0])}><ArrowLeftToLine size={10} /> Source</Btn>
                    <Btn primary onClick={() => p.onTraceOut(t, t.outputs[0].address)}>Trace <ArrowRightFromLine size={10} /></Btn>
                  </div>
                </div>
                <div className="flex items-center gap-2"><span className="text-[10px] text-faint w-8">from</span><Addr a={t.inputs[0].address} /></div>
                <div className="flex items-center gap-2"><span className="text-[10px] text-faint w-8">to</span><Addr a={t.outputs[0].address} /></div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
