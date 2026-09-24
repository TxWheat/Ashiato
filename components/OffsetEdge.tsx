'use client'

import { BaseEdge, EdgeProps, Position, getBezierPath } from 'reactflow'

export interface LabelEdgeData {
  /** Sideways bend in px; parallel transactions between one pair get different offsets */
  offset?: number
  /** Main line, e.g. "1K USDT ($1,372 NZD) · 3 txs" */
  line1?: string
  /** Second line, e.g. the date or date range */
  line2?: string
  color?: string
  bold?: boolean
}

function quadPath(sx: number, sy: number, tx: number, ty: number, off: number) {
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.hypot(dx, dy) || 1
  // Control point pushed perpendicular to the line; the curve apex sits at `off`
  const cx = (sx + tx) / 2 + (-dy / len) * off * 2
  const cy = (sy + ty) / 2 + (dx / len) * off * 2
  return `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`
}

/**
 * Edge with its label written along the curve (Breadcrumbs-style): amount and
 * value on the first line, date underneath, and an arrow showing direction.
 * Text always reads left-to-right; for right-to-left edges it runs along the
 * reversed path and the arrow points back.
 */
export default function LabelEdge(props: EdgeProps<LabelEdgeData>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props
  const off = data?.offset ?? 0
  const bez = (x1: number, y1: number, p1: Position, x2: number, y2: number, p2: Position) =>
    getBezierPath({ sourceX: x1, sourceY: y1, sourcePosition: p1, targetX: x2, targetY: y2, targetPosition: p2 })[0]

  const path = off ? quadPath(sourceX, sourceY, targetX, targetY, off) : bez(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition)
  const reversed = sourceX > targetX
  const textPath = reversed
    ? off ? quadPath(targetX, targetY, sourceX, sourceY, -off) : bez(targetX, targetY, targetPosition, sourceX, sourceY, sourcePosition)
    : path
  const pathId = `lbl-${id.replace(/[^\w-]/g, '_')}`
  const color = data?.color ?? 'rgb(var(--fg))'
  const arrowL = reversed ? '← ' : ''
  const arrowR = reversed ? '' : ' →'

  const text = (content: string, dy: number, size: number, weight: number, fill: string) => (
    <text dy={dy} style={{ fontSize: size, fontWeight: weight, fill, paintOrder: 'stroke', stroke: 'rgb(var(--bg))', strokeWidth: 4, strokeLinejoin: 'round', cursor: 'pointer' }}>
      <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">{content}</textPath>
    </text>
  )

  return (
    <>
      <path id={pathId} d={textPath} fill="none" stroke="none" />
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={22} />
      {data?.line1 && text(`${arrowL}${data.line1}${arrowR}`, -7, 11, data.bold ? 700 : 500, color)}
      {data?.line2 && text(data.line2, 12, 10, 400, 'rgb(var(--muted))')}
    </>
  )
}
