'use client'

import { ArrowDown, ExternalLink, X } from 'lucide-react'
import { truncate } from '@/lib/detect-chain'
import { explorerTxUrl, fmtAmount, fmtDateTime } from '@/lib/format'
import type { CollapsedChain } from '@/lib/collapse'
import type { Chain } from '@/lib/types'

/** One hop along a folded chain: the transactions that moved the money from `from` to `to` */
export interface ChainStep {
  from: string
  to: string
  txs: { txid: string; amount: number; asset: string; time: number; why?: string }[]
}

/**
 * A run of hops drawn as one line on the graph, opened: every address along it, in order,
 * with the transactions between each pair.
 */
export default function ChainDetail({ chain, steps, chainOf, nameOf, onSelect, onClose }: {
  chain: CollapsedChain
  steps: ChainStep[]
  chainOf: (address: string) => Chain
  nameOf: (address: string) => string | undefined
  onSelect: (address: string) => void
  onClose: () => void
}) {
  const Addr = ({ a }: { a: string }) => (
    <button onClick={() => onSelect(a)} title={`Open ${a}`} className="text-left min-w-0 hover:text-accent">
      <span className="block text-[13px] font-medium text-fg truncate">{nameOf(a) ?? truncate(a, 8)}</span>
      {nameOf(a) && <span className="block font-mono text-[10px] text-faint truncate">{truncate(a, 8)}</span>}
    </button>
  )
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-line flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Trail · {chain.hops} hops</div>
            <div className="text-[12px] text-muted">
              Drawn as one line on the graph{chain.peels ? `; ${chain.peels} small side payment${chain.peels === 1 ? '' : 's'} folded in` : ''}. Click an address to open it.
            </div>
          </div>
          <button onClick={onClose} className="text-faint hover:text-fg p-1" aria-label="Close"><X size={14} /></button>
        </div>
      </div>
      <ol className="flex-1 overflow-y-auto min-h-0 p-4 space-y-1">
        {steps.map((s, i) => (
          <li key={`${s.from}>${s.to}`}>
            {i === 0 && <Addr a={s.from} />}
            <div className="ml-2 my-1.5 pl-3 border-l-2 border-accent/60 space-y-1">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-faint"><ArrowDown size={11} /> Hop {i + 1}</div>
              {s.txs.length === 0 && <div className="text-[11px] text-faint">Transaction details not loaded</div>}
              {s.txs.map(t => (
                <div key={t.txid} className="text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-fg">{fmtAmount(t.amount, t.asset)}</span>
                    <span className="text-faint">{t.time ? fmtDateTime(t.time) : ''}</span>
                    <a href={explorerTxUrl(t.txid, chainOf(s.from))} target="_blank" rel="noopener noreferrer" title={t.txid}
                      className="ml-auto flex items-center gap-1 font-mono text-[10px] text-faint hover:text-fg">
                      {t.txid.slice(0, 10)}… <ExternalLink size={10} />
                    </a>
                  </div>
                  {t.why && <div className="text-faint leading-snug">{t.why}</div>}
                </div>
              ))}
            </div>
            <Addr a={s.to} />
          </li>
        ))}
      </ol>
    </div>
  )
}
