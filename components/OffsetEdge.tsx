'use client'

import { BaseEdge, EdgeLabelRenderer, EdgeProps } from 'reactflow'

export interface OffsetEdgeData {
  /** Sideways bend in px; parallel transactions between one pair get different offsets */
  offset: number
  onSelect?: () => void
}

/**
 * A curved edge that can be bent sideways, so several individual transactions
 * between the same two addresses are drawn as separate, readable lines.
 */
export default function OffsetEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data, label }: EdgeProps<OffsetEdgeData>) {
  const off = data?.offset ?? 0
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  // Control point pushed perpendicular to the line; the curve apex sits at `off`
  const cx = (sourceX + targetX) / 2 + (-dy / len) * off * 2
  const cy = (sourceY + targetY) / 2 + (dx / len) * off * 2
  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`
  const lx = 0.25 * sourceX + 0.5 * cx + 0.25 * targetX
  const ly = 0.25 * sourceY + 0.5 * cy + 0.25 * targetY

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={20} />
      {label && (
        <EdgeLabelRenderer>
          <div
            onClick={data?.onSelect}
            style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all' }}
            className="nodrag nopan cursor-pointer whitespace-nowrap px-1.5 py-0.5 text-[10px] font-mono bg-panel border border-accent/50 text-fg hover:border-accent"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
