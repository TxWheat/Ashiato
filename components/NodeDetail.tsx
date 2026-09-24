'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { X, ExternalLink, Copy, List, Trash2, Droplets, ArrowRightFromLine, ArrowLeftToLine, Check } from 'lucide-react'
import { NodeData } from '@/lib/types'
import { Cluster } from '@/lib/heuristics/cluster'
import { ENTITY_STYLE, explorerAddressUrl, fmtAmount, fmtBalance } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

const RISK_BAR: Record<string, string> = {
  clean: 'bg-green-500', low: 'bg-lime-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500',
}

const HEURISTIC_NAME: Record<string, string> = {
  'deposit-address': 'Exchange deposit address',
  'coinjoin-participant': 'CoinJoin participant',
  'tornado-usage': 'Tornado Cash usage',
  'tornado-address-match': 'Tornado: address reuse',
  'tornado-gas-fingerprint': 'Tornado: gas-price fingerprint',
}

interface Props {
  node: NodeData
  loaded: number
  isLoading: boolean
  canRemove: boolean
  cluster?: Cluster
  taint?: { amount: number; asset: string; isSeed: boolean }
  autoRunning: boolean
  onClose: () => void
  onTransactions: () => void
  onRemove: () => void
  onTaint: () => void
  onAutoTrace: (direction: 'forward' | 'backward') => void
  onShowCluster: () => void
  onNote: (note: string) => void
}

export default function NodeDetail(p: Props) {
  const { node } = p
  const [copied, setCopied] = useState(false)
  const type = node.label?.type ?? 'unknown'
  const style = ENTITY_STYLE[type]

  const copy = () => {
    navigator.clipboard.writeText(node.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const Btn = ({ onClick, icon, children, disabled, primary }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; disabled?: boolean; primary?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center justify-center gap-1.5 h-8 px-2 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        primary ? 'bg-accent hover:bg-accent-hover text-accent-fg' : 'bg-raised hover:bg-line text-fg'
      )}
    >
      {icon}
      {children}
    </button>
  )

  return (
    <div className="absolute right-3 top-3 bottom-3 z-20 w-80 max-w-[calc(100%-1.5rem)] flex flex-col bg-panel border border-line shadow-2xl">
      <div className="flex items-center justify-between h-11 px-4 border-b border-line flex-shrink-0">
        <span className="text-sm font-medium text-fg">Address</span>
        <button onClick={p.onClose} className="text-faint hover:text-fg p-1" aria-label="Close">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-line">
        <section className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <code className="text-[11px] text-fg break-all leading-relaxed flex-1">{node.address}</code>
            <button onClick={copy} title="Copy" className="text-faint hover:text-fg mt-0.5">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5', style.badge)}>{style.label}</span>
            {node.label && <span className="text-sm font-medium text-fg">{node.label.name}</span>}
          </div>
          {node.label?.inferredBy && (
            <p className="text-[11px] text-muted">
              Inferred by the {node.label.inferredBy} heuristic · {Math.round((node.label.confidence ?? 0) * 100)}% confidence
            </p>
          )}
          {node.label?.source && (
            <p className="text-[11px] text-faint">
              Source:{' '}
              {node.label.sourceUrl?.startsWith('http') ? (
                <a href={node.label.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">
                  {node.label.source}
                </a>
              ) : (
                node.label.source
              )}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Balance</div>
              <div className="text-xs font-mono text-fg">{node.isExpanded || node.isOrigin ? fmtBalance(node.balance, node.chain) : '–'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Transactions</div>
              <div className="text-xs text-fg">
                {p.loaded ? `${p.loaded} loaded` : '–'}
                {node.chain === 'btc' && node.txCount > 0 && <span className="text-faint"> / {node.txCount.toLocaleString()}</span>}
              </div>
            </div>
          </div>
        </section>

        {node.risk && (
          <section className="p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-faint">Risk</span>
              <span className="text-xs font-mono text-fg">
                {node.risk.score}/100 · <span className="capitalize">{node.risk.level}</span>
              </span>
            </div>
            <div className="h-1 bg-raised">
              <div className={clsx('h-full', RISK_BAR[node.risk.level])} style={{ width: `${Math.max(2, node.risk.score)}%` }} />
            </div>
            <ul className="space-y-1 text-[11px] text-muted list-disc pl-4">
              {node.risk.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </section>
        )}

        {!!node.findings?.length && (
          <section className="p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-faint">Heuristic findings</div>
            {node.findings.map((f, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs font-medium text-fg">
                  <span>{HEURISTIC_NAME[f.heuristic] ?? f.heuristic}</span>
                  <span className="font-mono text-faint">{Math.round(f.confidence * 100)}%</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted list-disc pl-4">
                  {f.reasons.map((r, k) => <li key={k}>{r}</li>)}
                </ul>
              </div>
            ))}
          </section>
        )}

        {p.cluster && (
          <section className="p-4 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-faint">Cluster C{p.cluster.id}</span>
              <button onClick={p.onShowCluster} className="text-[11px] text-accent hover:underline">
                Show all {p.cluster.members.length} on graph
              </button>
            </div>
            {p.cluster.label && <div className="text-xs text-fg">Controlled by: {p.cluster.label.name.replace(' (cluster)', '')}</div>}
            <ul className="space-y-0.5 text-[11px] text-muted list-disc pl-4">
              {p.cluster.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </section>
        )}

        {p.taint && (
          <section className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Taint</div>
            <div className="text-xs font-mono text-red-500">
              {p.taint.isSeed ? 'This address is the taint source' : `${fmtAmount(p.taint.amount, p.taint.asset, 8)} tainted received`}
            </div>
          </section>
        )}

        <section className="p-4">
          <label className="text-[10px] uppercase tracking-wider text-faint" htmlFor="note">Your note</label>
          <textarea
            id="note"
            key={node.address}
            defaultValue={node.note ?? ''}
            onBlur={e => p.onNote(e.target.value)}
            placeholder="e.g. Scammer's second wallet, per victim statement"
            rows={2}
            className="mt-1.5 w-full bg-bg border border-line focus:border-accent outline-none p-2 text-xs text-fg placeholder:text-faint resize-none"
          />
        </section>
      </div>

      <div className="p-3 border-t border-line grid grid-cols-2 gap-2 flex-shrink-0">
        <Btn primary onClick={p.onTransactions} disabled={p.isLoading} icon={<List size={12} />}>
          {p.isLoading ? 'Loading…' : 'Transactions'}
        </Btn>
        <Btn onClick={p.onTaint} icon={<Droplets size={12} />}>Taint from here</Btn>
        <Btn onClick={() => p.onAutoTrace('forward')} disabled={p.autoRunning} icon={<ArrowRightFromLine size={12} />}>Auto-trace out</Btn>
        <Btn onClick={() => p.onAutoTrace('backward')} disabled={p.autoRunning} icon={<ArrowLeftToLine size={12} />}>Source of funds</Btn>
        <a
          href={explorerAddressUrl(node.address, node.chain)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium bg-raised hover:bg-line text-fg"
        >
          <ExternalLink size={12} /> Explorer
        </a>
        {p.canRemove ? (
          <Btn onClick={p.onRemove} icon={<Trash2 size={12} />}>Remove</Btn>
        ) : (
          <span className="flex items-center justify-center text-[10px] text-faint">{truncate(node.address, 5)}</span>
        )}
      </div>
    </div>
  )
}
