'use client'

import { Handle, Position } from 'reactflow'
import { clsx } from 'clsx'
import { NodeData } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'

const borderColors = {
  exchange: 'border-green-500',
  mixer:    'border-orange-500',
  scam:     'border-red-500',
  defi:     'border-purple-500',
  wallet:   'border-slate-500',
  unknown:  'border-slate-600',
}

const bgColors = {
  exchange: 'bg-green-500/10',
  mixer:    'bg-orange-500/10',
  scam:     'bg-red-500/10',
  defi:     'bg-purple-500/10',
  wallet:   'bg-slate-800/60',
  unknown:  'bg-slate-800/60',
}

const badgeColors = {
  exchange: 'bg-green-500/20 text-green-400',
  mixer:    'bg-orange-500/20 text-orange-400',
  scam:     'bg-red-500/20 text-red-400',
  defi:     'bg-purple-500/20 text-purple-400',
  wallet:   'bg-slate-600/40 text-slate-400',
  unknown:  'bg-slate-700 text-slate-500',
}

interface Props {
  data: NodeData
}

export default function AddressNode({ data }: Props) {
  const type = data.label?.type ?? 'unknown'

  return (
    <div
      className={clsx(
        'rounded-lg border-2 px-3 py-2.5 min-w-[170px] shadow-xl backdrop-blur-sm',
        borderColors[type],
        bgColors[type],
        data.isOrigin && '!border-cyan-400 !bg-cyan-500/10 ring-2 ring-cyan-400/20'
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-600 !border-slate-500 !w-2 !h-2" />

      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={clsx(
          'text-[9px] font-mono uppercase font-bold px-1.5 py-0.5 rounded',
          data.chain === 'btc' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'
        )}>
          {data.chain}
        </span>
        {data.label && (
          <span className={clsx('text-[9px] px-1.5 py-0.5 rounded font-semibold capitalize', badgeColors[type])}>
            {type}
          </span>
        )}
        {data.isOrigin && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-semibold">
            origin
          </span>
        )}
      </div>

      <div className="font-semibold text-sm text-white leading-tight">
        {data.label?.name ?? truncate(data.address, 7)}
      </div>

      {data.label?.name && (
        <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">
          {truncate(data.address)}
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!bg-slate-600 !border-slate-500 !w-2 !h-2" />
    </div>
  )
}
