'use client'

import { createContext, useContext } from 'react'
import { NodeToolbar, Position, useStore } from 'reactflow'
import { clsx } from 'clsx'
import { Table2, Users, Info, Tag, Copy, ExternalLink, Trash2, Bell, BellRing } from 'lucide-react'

// Breadcrumbs-style quick actions: clicking a node shows these around it instead of
// opening the side panel straight away.

export type NodeAction = 'transactions' | 'relationships' | 'details' | 'label' | 'watch' | 'copy' | 'explorer' | 'remove'

export const NodeMenuContext = createContext<{ openFor: string | null; act: (address: string, action: NodeAction) => void; watched?: Set<string> } | null>(null)

const TOP: [NodeAction, string, React.ReactNode, string][] = [
  ['transactions', 'Transactions', <Table2 key="t" size={12} />, 'Smart expand: every transaction in a big table'],
  ['relationships', 'Relationships', <Users key="r" size={12} />, 'Who this address sent to and received from'],
  ['details', 'Details', <Info key="d" size={12} />, 'Labels (yours, community, open data), risk and notes'],
]
const BOTTOM: [NodeAction, string, React.ReactNode][] = [
  ['label', 'Label', <Tag key="l" size={12} />],
  ['watch', 'Watch: alert me when funds move (Pro)', <Bell key="w" size={12} />],
  ['copy', 'Copy address', <Copy key="c" size={12} />],
  ['explorer', 'Open in block explorer', <ExternalLink key="e" size={12} />],
  ['remove', 'Remove from graph', <Trash2 key="x" size={12} />],
]

// nodrag/nopan/nowheel: clicks on the menu are clicks, never graph drags or pans
const bubble = 'nodrag nopan nowheel flex items-center bg-panel border border-line shadow-lg p-0.5'

export default function NodeMenu({ id }: { id: string }) {
  const menu = useContext(NodeMenuContext)
  // Shrinks with the graph when zoomed out (to a readable minimum), so it never dwarfs the node
  const scale = useStore(st => Math.min(1, Math.max(0.7, st.transform[2])))
  if (!menu) return null
  const open = menu.openFor === id
  const act = (a: NodeAction) => (e: React.MouseEvent) => {
    e.stopPropagation()
    menu.act(id, a)
  }
  return (
    <>
      <NodeToolbar isVisible={open} position={Position.Top} offset={6}>
        <div className={bubble} style={{ transform: `scale(${scale})`, transformOrigin: 'bottom center' }}>
          {TOP.map(([a, label, icon, title]) => (
            <button key={a} onClick={act(a)} title={title}
              className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium text-muted hover:text-fg hover:bg-raised whitespace-nowrap">
              <span className={clsx(a === 'transactions' && 'text-accent')}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </NodeToolbar>
      <NodeToolbar isVisible={open} position={Position.Bottom} offset={6}>
        <div className={bubble} style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
          {BOTTOM.map(([a, title, icon]) => {
            const on = a === 'watch' && !!menu.watched?.has(id)
            const label = on ? 'Watching: click to stop' : title
            return (
              <button key={a} onClick={act(a)} title={label} aria-label={label} aria-pressed={a === 'watch' ? on : undefined}
                className={clsx('grid place-items-center w-6 h-6 hover:bg-raised', on ? 'text-accent' : 'text-muted', a === 'remove' ? 'hover:text-red-500' : 'hover:text-fg')}>
                {on ? <BellRing size={12} /> : icon}
              </button>
            )
          })}
        </div>
      </NodeToolbar>
    </>
  )
}
