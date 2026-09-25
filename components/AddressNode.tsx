'use client'

import { Handle, Position } from 'reactflow'
import { clsx } from 'clsx'
import { NodeData } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ENTITY_STYLE, fmtAmount } from '@/lib/format'

export interface AddressNodeData extends NodeData {
  view: {
    clusterSize?: number
    taintAsset?: string
    isTaintSeed?: boolean
    loading?: boolean
    /** Relative to the selected address: sent it funds (in), received from it (out), or both */
    relation?: 'in' | 'out' | 'both'
    /** Just added to the chart */
    fresh?: boolean
    /** Trail stopped here because the traced funds were this share (0–1) of a pool */
    pooled?: number
  }
}

const RISK_TEXT: Record<string, string> = {
  clean: 'text-green-500',
  low: 'text-lime-500',
  medium: 'text-yellow-500',
  high: 'text-orange-500',
  critical: 'text-red-500',
}

export default function AddressNode({ data, selected }: { data: AddressNodeData; selected?: boolean }) {
  const type = data.label?.type ?? 'unknown'
  const style = ENTITY_STYLE[type]
  const labelled = !!data.label

  return (
    <div
      className={clsx(
        'relative w-[196px] bg-panel border px-3 py-2.5 transition-shadow',
        data.isOrigin ? 'border-accent border-2' : labelled ? `${style.border} border-2` : 'border-line',
        data.label?.inferredBy && 'border-dashed',
        selected && 'ring-2 ring-accent/60',
        data.view.relation === 'in' && 'shadow-[0_0_0_2px_rgb(34_197_94),0_0_22px_rgb(34_197_94/0.45)]',
        data.view.relation === 'out' && 'shadow-[0_0_0_2px_rgb(239_68_68),0_0_22px_rgb(239_68_68/0.45)]',
        data.view.relation === 'both' && 'shadow-[0_0_0_2px_rgb(234_179_8),0_0_22px_rgb(234_179_8/0.45)]',
        data.view.fresh && 'node-fresh',
        data.view.loading && 'animate-pulse'
      )}
    >
      {data.view.relation && (
        <span
          className={clsx(
            'absolute -top-2.5 left-2 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white',
            data.view.relation === 'in' ? 'bg-green-500' : data.view.relation === 'out' ? 'bg-red-500' : 'bg-yellow-500'
          )}
          title={data.view.relation === 'in' ? 'Sent funds to the selected address' : data.view.relation === 'out' ? 'Received funds from the selected address' : 'Sent and received funds with the selected address'}
        >
          {data.view.relation === 'in' ? 'in' : data.view.relation === 'out' ? 'out' : 'in + out'}
        </span>
      )}
      {data.view.pooled !== undefined && (
        <span className="absolute -top-2.5 right-2 px-1.5 text-[9px] font-semibold uppercase tracking-wider bg-amber-500 text-black"
          title={`The traced funds were only ${Math.round(data.view.pooled * 100)}% of the pool here, so the trail stopped`}>
          pooled {Math.round(data.view.pooled * 100)}%
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!bg-line !border-0 !w-1.5 !h-3 !rounded-none" />

      <div className="flex items-center gap-1.5 mb-1.5 text-[9px] font-medium uppercase tracking-wider">
        <span className={clsx('w-1.5 h-1.5 rounded-full', data.chain === 'btc' ? 'bg-orange-500' : 'bg-violet-500')} />
        <span className="text-faint">{data.chain}</span>
        {labelled && <span className={clsx('px-1 py-px', style.badge)}>{style.label.split(' ')[0]}</span>}
        {data.isOrigin && <span className="px-1 py-px bg-accent/20 text-accent">origin</span>}
        {data.clusterId !== undefined && (
          <span className="px-1 py-px bg-raised text-muted" title={`Cluster of ${data.view.clusterSize} addresses`}>
            C{data.clusterId}
          </span>
        )}
        {data.risk && (
          <span className={clsx('ml-auto font-mono normal-case', RISK_TEXT[data.risk.level])} title={`Risk ${data.risk.level}`}>
            {data.risk.score}
          </span>
        )}
      </div>

      <div className="text-[13px] font-medium text-fg leading-tight truncate" title={data.label?.name ?? data.ens ?? data.address}>
        {data.label?.name ?? data.ens ?? truncate(data.address, 7)}
      </div>
      {(labelled || data.ens) && (
        <div className="text-[10px] font-mono text-faint mt-0.5 truncate">
          {labelled && data.ens ? `${data.ens} · ` : ''}{truncate(data.address)}
        </div>
      )}

      {(data.view.isTaintSeed || (data.taint ?? 0) > 0) && (
        <div className="mt-1.5 pt-1.5 border-t border-line text-[10px] font-mono text-red-500">
          {data.view.isTaintSeed ? 'taint source' : `${fmtAmount(data.taint!, data.view.taintAsset ?? '', 4)} tainted`}
        </div>
      )}
      {data.note && <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-yellow-500" title={data.note} />}

      <Handle type="source" position={Position.Right} className="!bg-line !border-0 !w-1.5 !h-3 !rounded-none" />
    </div>
  )
}

export interface TxHubData {
  txid: string
  chain: 'btc' | 'eth'
  label: string
  inputs: { address: string; amount: number; asset: string }[]
  outputs: { address: string; amount: number; asset: string }[]
}

/** A transaction drawn as its own node: inputs flow in, outputs flow out */
export function TxNode({ data, selected }: { data: TxHubData; selected?: boolean }) {
  return (
    <div className={clsx('w-[150px] border-2 border-dashed bg-bg px-3 py-2 text-center cursor-pointer transition-colors', selected ? 'border-accent' : 'border-line hover:border-accent')}>
      <Handle type="target" position={Position.Left} className="!bg-line !border-0 !w-1.5 !h-3 !rounded-none" />
      <div className="text-[9px] font-medium uppercase tracking-wider text-faint">{data.chain} transaction</div>
      <div className="text-[12px] font-mono text-fg truncate">{data.label}</div>
      <Handle type="source" position={Position.Right} className="!bg-line !border-0 !w-1.5 !h-3 !rounded-none" />
    </div>
  )
}
