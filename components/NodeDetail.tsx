'use client'

import { NodeData } from '@/lib/types'
import { X, ExternalLink, Copy, GitBranch } from 'lucide-react'
import { clsx } from 'clsx'
import { truncate } from '@/lib/detect-chain'

function fmtBalance(balance: number, chain: 'btc' | 'eth'): string {
  if (chain === 'btc') {
    const btc = balance / 1e8
    return btc === 0 ? '0 BTC' : `${btc.toFixed(8)} BTC`
  }
  const eth = balance / 1e18
  return eth === 0 ? '0 ETH' : `${eth.toFixed(6)} ETH`
}

function explorerUrl(address: string, chain: 'btc' | 'eth'): string {
  if (chain === 'btc') return `https://blockstream.info/address/${address}`
  return `https://etherscan.io/address/${address}`
}

const typeBadge: Record<string, string> = {
  exchange: 'bg-green-500/15 text-green-400 border border-green-500/30',
  mixer:    'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  scam:     'bg-red-500/15 text-red-400 border border-red-500/30',
  defi:     'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  wallet:   'bg-slate-600/40 text-slate-400 border border-slate-600/40',
  unknown:  'bg-slate-700/40 text-slate-500 border border-slate-700',
}

interface Props {
  node: NodeData
  onClose: () => void
  onExpand: (address: string, chain: 'btc' | 'eth') => void
}

export default function NodeDetail({ node, onClose, onExpand }: Props) {
  const copy = () => navigator.clipboard.writeText(node.address)
  const type = node.label?.type ?? 'unknown'

  return (
    <div className="absolute right-4 top-4 z-20 w-72 bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <span className="text-sm font-semibold text-white">Address Details</span>
        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-0.5">
          <X size={15} />
        </button>
      </div>

      <div className="p-4 space-y-3.5">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Address</div>
          <div className="flex items-start gap-2">
            <code className="text-[11px] text-cyan-400 font-mono break-all leading-relaxed flex-1">
              {node.address}
            </code>
            <button
              onClick={copy}
              title="Copy address"
              className="text-slate-600 hover:text-slate-300 transition-colors mt-0.5 flex-shrink-0"
            >
              <Copy size={13} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Chain</div>
            <span className={clsx(
              'text-[11px] px-2 py-0.5 rounded font-mono font-bold uppercase',
              node.chain === 'btc' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
            )}>
              {node.chain}
            </span>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Balance</div>
            <div className="text-[11px] text-white font-mono">{fmtBalance(node.balance, node.chain)}</div>
          </div>
        </div>

        {node.label ? (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Entity</div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{node.label.name}</span>
              <span className={clsx('text-[10px] px-1.5 py-0.5 rounded capitalize font-medium', typeBadge[type])}>
                {type}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Entity</div>
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded capitalize font-medium', typeBadge['unknown'])}>
              Unknown
            </span>
          </div>
        )}

        {node.txCount > 0 && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Transactions</div>
            <div className="text-[11px] text-white">{node.txCount.toLocaleString()}</div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onExpand(node.address, node.chain)}
            className="flex items-center gap-1.5 flex-1 justify-center text-[11px] bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-black font-bold py-2 rounded-lg transition-colors"
          >
            <GitBranch size={12} />
            Expand Node
          </button>
          <a
            href={explorerUrl(node.address, node.chain)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 px-3 rounded-lg transition-colors"
          >
            <ExternalLink size={11} />
            Explorer
          </a>
        </div>
      </div>
    </div>
  )
}
