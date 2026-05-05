'use client'

import { RawTransaction, Chain } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ExternalLink, GitBranch, X, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'

function fmtAmount(amount: number, chain: Chain): string {
  if (chain === 'btc') {
    const b = amount / 1e8
    return b === 0 ? '0 BTC' : `${b.toFixed(4)} BTC`
  }
  const e = amount / 1e18
  if (e === 0) return '0 ETH'
  if (e < 0.0001) return '<0.0001 ETH'
  return `${e.toFixed(4)} ETH`
}

function fmtDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function explorerTxUrl(txid: string, chain: Chain): string {
  return chain === 'btc'
    ? `https://blockstream.info/tx/${txid}`
    : `https://etherscan.io/tx/${txid}`
}

interface Props {
  address: string
  chain: Chain
  txs: RawTransaction[]
  expandingAddrs: Set<string>
  onExpand: (address: string, chain: Chain) => void
  onClose: () => void
}

export default function TxTable({ address, chain, txs, expandingAddrs, onExpand, onClose }: Props) {
  return (
    <div className="border-t border-slate-800 bg-[#020817] flex flex-col flex-shrink-0" style={{ height: 260 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-950/60 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-white">Transactions</span>
          <code className="text-[10px] text-cyan-400 font-mono bg-cyan-500/10 px-2 py-0.5 rounded">
            {truncate(address, 8)}
          </code>
          <span className="text-[10px] text-slate-600">{txs.length} shown · click Follow to expand into graph</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-white transition-colors p-1 rounded hover:bg-slate-800"
        >
          <X size={13} />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        {txs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-sm">
            No transactions found
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-950/90 backdrop-blur-sm z-10">
              <tr className="text-slate-600 uppercase text-[9px] tracking-widest">
                <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-2 font-medium">From</th>
                <th className="text-left px-4 py-2 font-medium">To</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium">Tx Hash</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {txs.map(tx =>
                tx.outputs.map((out, j) => (
                  <tr
                    key={`${tx.txid}-${j}`}
                    className={clsx(
                      'hover:bg-slate-900/40 transition-colors text-[11px]',
                      out.isChange && 'opacity-40'
                    )}
                  >
                    {j === 0 && (
                      <td
                        className="px-4 py-2 text-slate-500 whitespace-nowrap align-top"
                        rowSpan={tx.outputs.length}
                      >
                        {fmtDate(tx.timestamp)}
                      </td>
                    )}
                    {j === 0 && (
                      <td
                        className="px-4 py-2 font-mono text-slate-400 align-top"
                        rowSpan={tx.outputs.length}
                      >
                        <div className="flex items-center gap-1">
                          {tx.fromAddresses.length === 1
                            ? truncate(tx.fromAddresses[0])
                            : `${tx.fromAddresses.length} inputs`}
                          <ArrowRight size={10} className="text-slate-700 flex-shrink-0" />
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className={clsx(
                          out.address === address ? 'text-cyan-400' : 'text-slate-300'
                        )}>
                          {truncate(out.address)}
                        </span>
                        {out.isChange && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 whitespace-nowrap">
                            change
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-white whitespace-nowrap">
                      {fmtAmount(out.amount, chain)}
                    </td>
                    {j === 0 && (
                      <td
                        className="px-4 py-2 font-mono align-top"
                        rowSpan={tx.outputs.length}
                      >
                        <a
                          href={explorerTxUrl(tx.txid, chain)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-cyan-600 hover:text-cyan-400 transition-colors whitespace-nowrap"
                        >
                          {truncate(tx.txid, 5)}
                          <ExternalLink size={9} />
                        </a>
                      </td>
                    )}
                    <td className="px-4 py-2 whitespace-nowrap">
                      {out.address !== address && !out.isChange && (
                        <button
                          onClick={() => onExpand(out.address, chain)}
                          disabled={expandingAddrs.has(out.address)}
                          className={clsx(
                            'flex items-center gap-1 text-[10px] transition-colors',
                            expandingAddrs.has(out.address)
                              ? 'text-slate-600 cursor-wait'
                              : 'text-slate-500 hover:text-cyan-400'
                          )}
                        >
                          <GitBranch size={10} />
                          {expandingAddrs.has(out.address) ? 'Loading…' : 'Follow'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
