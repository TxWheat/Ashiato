'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { NodeResizer, NodeToolbar, Panel, Position } from 'reactflow'
import { Circle, MoveRight, RotateCw, Square, Trash2, Type } from 'lucide-react'
import { Annotation } from '@/lib/annotations'

// Drawing tools for the graph: boxes, circles, arrows and text notes (Breadcrumbs-style)

export const AnnotationContext = createContext<{
  update: (id: string, patch: Partial<Annotation>) => void
  remove: (id: string) => void
} | null>(null)

const STROKE = 'rgb(var(--accent))'

export function AnnotationNode({ data: a, selected }: { data: Annotation; selected?: boolean }) {
  const ctx = useContext(AnnotationContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(a.text ?? '')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(a.text ?? ''), [a.text])
  useEffect(() => { if (editing) box.current?.focus() }, [editing])
  if (!ctx) return null

  const finishEdit = () => {
    setEditing(false)
    if (draft !== (a.text ?? '')) ctx.update(a.id, { text: draft })
  }

  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={a.kind === 'arrow' ? 60 : 40} minHeight={a.kind === 'arrow' ? 20 : 30}
        lineStyle={{ borderColor: STROKE }} handleStyle={{ width: 8, height: 8, borderRadius: 0, background: STROKE }}
        onResizeEnd={(_, p) => ctx.update(a.id, { x: p.x, y: p.y, w: p.width, h: p.height })} />
      <NodeToolbar isVisible={!!selected} position={Position.Top} offset={8}>
        <div className="nodrag nopan flex items-center gap-0.5 bg-panel border border-line shadow-xl p-1">
          {a.kind === 'arrow' && (
            <button onClick={() => ctx.update(a.id, { rotate: ((a.rotate ?? 0) + 45) % 360 })} title="Rotate 45°" aria-label="Rotate"
              className="grid place-items-center w-7 h-7 text-muted hover:text-fg hover:bg-raised"><RotateCw size={13} /></button>
          )}
          {a.kind === 'text' && (
            <button onClick={() => setEditing(true)} className="h-7 px-2 text-[11px] text-muted hover:text-fg hover:bg-raised">Edit</button>
          )}
          <button onClick={() => ctx.remove(a.id)} title="Delete" aria-label="Delete"
            className="grid place-items-center w-7 h-7 text-muted hover:text-red-500 hover:bg-raised"><Trash2 size={13} /></button>
        </div>
      </NodeToolbar>

      {a.kind === 'rect' && <div className="w-full h-full border-2 border-accent/80 bg-accent/[0.04]" />}
      {a.kind === 'circle' && <div className="w-full h-full rounded-full border-2 border-accent/80 bg-accent/[0.04]" />}
      {a.kind === 'arrow' && (
        <svg width="100%" height="100%" style={{ transform: `rotate(${a.rotate ?? 0}deg)`, overflow: 'visible' }}>
          <defs>
            <marker id={`ah-${a.id}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M1,1.5 L11,6 L1,10.5 Z" style={{ fill: STROKE }} />
            </marker>
          </defs>
          <line x1="2%" y1="50%" x2="96%" y2="50%" style={{ stroke: STROKE, strokeWidth: 3 }} markerEnd={`url(#ah-${a.id})`} />
        </svg>
      )}
      {a.kind === 'text' && (
        editing ? (
          <textarea ref={box} value={draft} onChange={e => setDraft(e.target.value)} onBlur={finishEdit}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') finishEdit() }}
            className="nodrag nowheel w-full h-full resize-none bg-panel/90 border border-accent p-2 text-[13px] leading-snug text-fg outline-none" />
        ) : (
          <div onDoubleClick={() => setEditing(true)} title="Double-click to edit"
            className="w-full h-full overflow-hidden whitespace-pre-wrap p-2 text-[13px] leading-snug text-fg bg-panel/80 border border-line">
            {a.text || <span className="text-faint">Double-click to type</span>}
          </div>
        )
      )}
    </>
  )
}

const TOOLS: [Annotation['kind'], string, React.ReactNode][] = [
  ['rect', 'Box', <Square key="r" size={15} />],
  ['circle', 'Circle', <Circle key="c" size={15} />],
  ['arrow', 'Arrow', <MoveRight key="a" size={15} />],
  ['text', 'Text', <Type key="t" size={15} />],
]

/** Bottom-left drawing tools, beside the zoom controls */
export function AnnotationTools({ onAdd }: { onAdd: (kind: Annotation['kind']) => void }) {
  return (
    <Panel position="bottom-left" style={{ left: 48 }}>
      <div className="flex flex-col bg-panel border border-line shadow-sm" role="toolbar" aria-label="Draw on the graph">
        {TOOLS.map(([kind, label, icon]) => (
          <button key={kind} onClick={() => onAdd(kind)} title={`Add ${label.toLowerCase()}`} aria-label={`Add ${label.toLowerCase()}`}
            className="grid place-items-center w-[26px] h-[26px] text-muted hover:text-fg hover:bg-raised border-b border-line last:border-b-0">
            {icon}
          </button>
        ))}
      </div>
    </Panel>
  )
}
