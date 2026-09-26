'use client'

import { createContext, useContext } from 'react'
import { NodeToolbar, Position } from 'reactflow'
import { clsx } from 'clsx'
import { Table2, Users, Info, Tag, Copy, ExternalLink, Trash2 } from 'lucide-react'

// Breadcrumbs-style quick actions: clicking a node shows these around it instead of
// opening the side panel straight away.

export type NodeAction = 'transactions' | 'relationships' | 'details' | 'label' | 'copy' | 'explorer' | 'remove'

export const NodeMenuContext = createContext<{ openFor: string | null; act: (address: string, action: NodeAction) => void } | null>(null)

const TOP: [NodeAction, string, React.ReactNode, string][] = [
  ['transactions', 'Transactions', <Table2 key="t" size={15} />, 'Smart expand: every transaction in a big table'],
  ['relationships', 'Relationships', <Users key="r" size={15} />, 'Who this address sent to and received from'],
  ['details', 'Details', <Info key="d" size={15} />, 'Labels (yours, community, open data), risk and notes'],
]
const BOTTOM: [NodeAction, string, React.ReactNode][] = [
  ['label', 'Label', <Tag key="l" size={14} />],
  ['copy', 'Copy address', <Copy key="c" size={14} />],
  ['explorer', 'Open in block explorer', <ExternalLink key="e" size={14} />],
  ['remove', 'Remove from graph', <Trash2 key="x" size={14} />],
]

// nodrag/nopan/nowheel: clicks on the menu are clicks, never graph drags or pans
const bubble = 'nodrag nopan nowheel flex items-center gap-0.5 bg-panel border border-line shadow-xl p-1'

export default function NodeMenu({ id }: { id: string }) {
  const menu = useContext(NodeMenuContext)
  if (!menu) return null
  const open = menu.openFor === id
  const act = (a: NodeAction) => (e: React.MouseEvent) => {
    e.stopPropagation()
    menu.act(id, a)
  }
  return (
    <>
      <NodeToolbar isVisible={open} position={Position.Top} offset={10}>
        <div className={bubble}>
          {TOP.map(([a, label, icon, title]) => (
            <button key={a} onClick={act(a)} title={title}
              className="flex flex-col items-center gap-0.5 w-[84px] py-1.5 text-[10px] font-medium text-muted hover:text-fg hover:bg-raised">
              <span className={clsx(a === 'transactions' && 'text-accent')}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </NodeToolbar>
      <NodeToolbar isVisible={open} position={Position.Bottom} offset={10}>
        <div className={bubble}>
          {BOTTOM.map(([a, title, icon]) => (
            <button key={a} onClick={act(a)} title={title} aria-label={title}
              className={clsx('grid place-items-center w-8 h-8 text-muted hover:bg-raised', a === 'remove' ? 'hover:text-red-500' : 'hover:text-fg')}>
              {icon}
            </button>
          ))}
        </div>
      </NodeToolbar>
    </>
  )
}
