'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { ExternalLink, GitBranch, X, ArrowRight, AlertTriangle, ArrowRightFromLine, ArrowLeftToLine } from 'lucide-react'
import { EntityLabel, RawTransaction, TxIO, transferKey } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ENTITY_STYLE, explorerTxUrl, fmtAmount, fmtDate } from '@/lib/format'

interface Props {
  address: string
  txs: RawTransaction[]
  loading?: boolean
  hasMore: boolean
  loadingMore: boolean
  warnings?: string[]
  onGraph: Set<string>
  followingAddrs: Set<string>
  labelOf: (a: string) => EntityLabel | undefined
  ensOf: (a: string) => string | undefined
  tracing: boolean
  onTrace: (tx: RawTransaction, direction: 'forward' | 'backward') => void
  onFollow: (address: string) => void
  onLoadMore: () => void
  onClose: () => void
}

const SHOW = 4

export default function TxTable(p: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const Party = ({ io, side }: { io: TxIO; side: 'in' | 'out' }) => {
    const isMe = io.address === p.address
    const label = p.labelOf(io.address)
    const onGraph = p.onGraph.has(io.address)
    const busy = p.followingAddrs.has(io.address)
    return (
      <div className={clsx('flex items-center gap-2 min-w-0 h-6', io.isChange && 'opacity-60')}>
        {label && <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', ENTITY_STYLE[label.type].dot)} title={label.type} />}
        <span className={clsx('truncate', isMe ? 'text-accent' : 'text-fg', !label && !p.ensOf(io.address) && 'font-mono')} title={io.address}>
          {label ? label.name : p.ensOf(io.address) ?? truncate(io.address, 6)}
        </span>
        {io.isChange && (
          <span
            className="text-[9px] px-1 bg-yellow-500/15 text-yellow-600 whitespace-nowrap"
            title={io.change ? `${Math.round(io.change.confidence * 100)}%: ${io.change.reasons.join('; ')}` : 'likely change'}
          >
            change{io.change ? ` ${Math.round(io.change.confidence * 100)}%` : ''}
          </span>
        )}
        {side === 'out' && <span className="ml-auto font-mono text-muted whitespace-nowrap">{fmtAmount(io.amount, '', 8).trim()}</span>}
        {side === 'in' && io.amount > 0 && <span className="ml-auto font-mono text-faint whitespace-nowrap">{fmtAmount(io.amount, '', 8).trim()}</span>}
        {!isMe && (
          <button
            onClick={() => p.onFollow(io.address)}
            disabled={busy || onGraph}
            title={onGraph ? 'Already on graph' : side === 'in' ? 'Follow the sender (source of funds)' : 'Follow the recipient'}
            className={clsx(
              'flex items-center gap-1 text-[10px] font-medium px-1.5 h-5 flex-shrink-0 transition-colors',
              onGraph ? 'text-faint cursor-default' : busy ? 'text-faint cursor-wait' : 'text-muted hover:text-accent hover:bg-accent/10'
            )}
          >
            <GitBranch size={10} />
            {onGraph ? 'On graph' : busy ? 'Adding…' : 'Follow'}
          </button>
        )}
      </div>
    )
  }

  const List = ({ tx, side }: { tx: RawTransaction; side: 'in' | 'out' }) => {
    const items = side === 'in' ? tx.inputs : tx.outputs
    const key = `${transferKey(tx)}:${side}`
    const open = expanded.has(key)
    const shown = open ? items : items.slice(0, SHOW)
    return (
      <div className="min-w-0">
        {tx.isCoinbase && side === 'in' && <div className="h-6 text-faint">Coinbase (newly mined)</div>}
        {shown.map((io, k) => <Party key={k} io={io} side={side} />)}
        {items.length > SHOW && (
          <button
            onClick={() => setExpanded(prev => { const n = new Set(prev); if (open) n.delete(key); else n.add(key); return n })}
            className="text-[10px] text-faint hover:text-fg"
          >
            {open ? 'Show fewer' : `+${items.length - SHOW} more`}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="border-t border-line bg-bg flex flex-col flex-shrink-0 h-[300px]">
      <div className="flex items-center justify-between h-10 px-4 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-medium text-fg">Transactions</span>
          <code className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5">{truncate(p.address, 8)}</code>
          <span className="text-[10px] text-faint truncate hidden sm:block">
            {p.loading ? 'Fetching…' : `${p.txs.length} loaded${p.hasMore ? ' · more available' : ''} · Trace follows a payment onward, Source walks it back, Follow adds one address`}
          </span>
        </div>
        <button onClick={p.onClose} className="text-faint hover:text-fg p-1" aria-label="Close transactions">
          <X size={14} />
        </button>
      </div>

      {!!p.warnings?.length && (
        <div className="px-4 py-1.5 border-b border-line bg-yellow-500/5 text-[10px] text-yellow-600 space-y-0.5">
          {p.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-1.5"><AlertTriangle size={10} />{w}</div>
          ))}
        </div>
      )}

      <div className="overflow-auto flex-1 text-[11px]">
        {p.loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted text-sm">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading transactions…
          </div>
        ) : p.txs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-faint text-sm">No transactions found</div>
        ) : (
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[120px_60px_1fr_16px_1fr_150px] gap-3 px-4 py-2 sticky top-0 bg-bg border-b border-line text-[9px] uppercase tracking-widest text-faint z-10">
              <span>Date</span><span>Dir</span><span>From</span><span /><span>To · amount</span><span>Tx</span>
            </div>
            {p.txs.map((tx, rowIndex) => {
              const sent = tx.inputs.some(i => i.address === p.address)
              const got = tx.outputs.some(o => o.address === p.address)
              const dir = sent && got ? 'self' : sent ? 'out' : 'in'
              return (
                <div key={`${transferKey(tx)}:${rowIndex}`} className="grid grid-cols-[120px_60px_1fr_16px_1fr_150px] gap-3 px-4 py-2 border-b border-line/60 hover:bg-panel">
                  <div className="text-muted whitespace-nowrap">
                    {fmtDate(tx.timestamp)}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[9px] px-1 bg-raised text-muted">{tx.asset}</span>
                      {tx.kind && tx.kind !== 'normal' && <span className="text-[9px] px-1 bg-raised text-faint">{tx.kind}</span>}
                    </div>
                  </div>
                  <div>
                    <span className={clsx('text-[9px] font-medium uppercase px-1.5 py-0.5', dir === 'in' ? 'bg-green-500/15 text-green-500' : dir === 'out' ? 'bg-red-500/15 text-red-500' : 'bg-raised text-muted')}>
                      {dir}
                    </span>
                    {tx.coinjoin && (
                      <div className="mt-1 text-[9px] px-1 bg-orange-500/15 text-orange-500 inline-block" title={tx.coinjoin.reasons.join('; ')}>
                        {tx.coinjoin.kind} CJ
                      </div>
                    )}
                  </div>
                  <List tx={tx} side="in" />
                  <ArrowRight size={11} className="text-faint mt-1.5" />
                  <List tx={tx} side="out" />
                  <div className="space-y-1.5">
                    <a
                      href={explorerTxUrl(tx.txid, tx.chain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-1 font-mono text-muted hover:text-accent whitespace-nowrap h-6 items-center"
                    >
                      {truncate(tx.txid, 5)}
                      <ExternalLink size={9} />
                    </a>
                    <div className="flex gap-1">
                      {dir !== 'out' && (
                        <button
                          onClick={() => p.onTrace(tx, 'backward')}
                          disabled={p.tracing}
                          title="Walk back to where these funds came from"
                          className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40"
                        >
                          <ArrowLeftToLine size={10} /> Source
                        </button>
                      )}
                      {dir !== 'in' && (
                        <button
                          onClick={() => p.onTrace(tx, 'forward')}
                          disabled={p.tracing}
                          title="Follow this payment onward"
                          className="flex items-center gap-1 h-6 px-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40"
                        >
                          Trace <ArrowRightFromLine size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {p.hasMore && (
              <div className="p-3 flex justify-center">
                <button
                  onClick={p.onLoadMore}
                  disabled={p.loadingMore}
                  className="h-8 px-4 text-[11px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-50"
                >
                  {p.loadingMore ? 'Loading…' : 'Load older transactions'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
