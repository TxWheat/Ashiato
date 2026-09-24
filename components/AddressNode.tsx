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
        data.view.loading && 'animate-pulse'
      )}
    >
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

export interface MoreNodeData {
  count: number
  side: 'in' | 'out'
  anchor: string
}

/** "+N more senders / recipients" placeholder that keeps the graph readable */
export function MoreNode({ data }: { data: MoreNodeData }) {
  return (
    <div className="w-[150px] border border-dashed border-line bg-bg px-3 py-2 text-center cursor-pointer hover:border-accent transition-colors">
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="text-sm font-medium text-fg">+{data.count}</div>
      <div className="text-[10px] text-faint">more {data.side === 'in' ? 'senders' : 'recipients'} · click to list</div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}
