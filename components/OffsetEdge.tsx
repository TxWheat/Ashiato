'use client'

import { BaseEdge, EdgeProps, Position } from 'reactflow'

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

type Pt = [number, number]

/** Same control points reactflow's getBezierPath uses, so we know the curve's midpoint and tangent */
function control(pos: Position, x1: number, y1: number, x2: number, y2: number): Pt {
  const off = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d))
  switch (pos) {
    case Position.Left: return [x1 - off(x1 - x2), y1]
    case Position.Right: return [x1 + off(x2 - x1), y1]
    case Position.Top: return [x1, y1 - off(y1 - y2)]
    default: return [x1, y1 + off(y2 - y1)]
  }
}

/** Path plus the point halfway along it and the direction of travel there */
function geometry(p: EdgeProps<LabelEdgeData>, off: number) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = p
  if (off) {
    // Quadratic curve whose apex sits `off` px to the side of the straight line
    const len = Math.hypot(tx - sx, ty - sy) || 1
    const cx = (sx + tx) / 2 + (-(ty - sy) / len) * off * 2
    const cy = (sy + ty) / 2 + ((tx - sx) / len) * off * 2
    return {
      path: `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`,
      mid: [0.25 * sx + 0.5 * cx + 0.25 * tx, 0.25 * sy + 0.5 * cy + 0.25 * ty] as Pt,
      dir: [tx - sx, ty - sy] as Pt,
    }
  }
  const [c1x, c1y] = control(p.sourcePosition, sx, sy, tx, ty)
  const [c2x, c2y] = control(p.targetPosition, tx, ty, sx, sy)
  return {
    path: `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`,
    mid: [0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * tx, 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ty] as Pt,
    // Cubic derivative at t=0.5 ∝ (P3 − P0) + (P2 − P1)
    dir: [tx - sx + c2x - c1x, ty - sy + c2y - c1y] as Pt,
  }
}

/**
 * Edge with a Breadcrumbs-style label laid along the line: amount and value
 * above, date underneath, and an arrow for direction. The label is drawn as
 * one rotated run of text (not per-glyph on a textPath, which renders ragged)
 * and is flipped so it never reads upside down.
 */
export default function LabelEdge(props: EdgeProps<LabelEdgeData>) {
  const { id, markerEnd, style, data } = props
  const { path, mid, dir } = geometry(props, data?.offset ?? 0)
  let angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
  const reversed = angle > 90 || angle < -90
  if (reversed) angle += 180
  const sw = Number(style?.strokeWidth ?? 1.5)
  const color = data?.color ?? 'rgb(var(--fg))'
  const halo = { paintOrder: 'stroke' as const, stroke: 'rgb(var(--bg))', strokeWidth: 3, strokeLinejoin: 'round' as const }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={22} />
      {(data?.line1 || data?.line2) && (
        <g transform={`translate(${mid[0]} ${mid[1]}) rotate(${angle})`} style={{ cursor: 'pointer' }} textAnchor="middle">
          {data?.line1 && (
            <text y={-(sw / 2 + 5)} style={{ ...halo, fontSize: 11, fontWeight: data.bold ? 700 : 500, fill: color }}>
              {`${reversed ? '← ' : ''}${data.line1}${reversed ? '' : ' →'}`}
            </text>
          )}
          {data?.line2 && (
            <text y={sw / 2 + 13} style={{ ...halo, fontSize: 10, fill: 'rgb(var(--muted))' }}>{data.line2}</text>
          )}
        </g>
      )}
    </>
  )
}
