'use client'

import { BaseEdge, EdgeProps, Position, useStore } from 'reactflow'

export interface LabelEdgeData {
  /** Sideways bend in px; parallel transactions between one pair get different offsets */
  offset?: number
  /** One of several parallel lines between a pair: always an arc (straight at offset 0), never an S-curve */
  parallel?: boolean
  /** Main line, e.g. "1K USDT ($1,372 NZD) · 3 txs" */
  line1?: string
  /** Second line, e.g. the date or date range */
  line2?: string
  color?: string
  bold?: boolean
  /** Soft halo under the line (traced funds, collapsed chains) */
  glow?: boolean
  /** Don't add a direction arrow to the label (the label says it already) */
  noArrowText?: boolean
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

interface Ends { sx: number; sy: number; tx: number; ty: number; sp: Position; tp: Position }

/** Path plus the point halfway along it and the direction of travel there */
function geometry(p: Ends, off: number, arc = false) {
  const { sx, sy, tx, ty } = p
  if (off || arc) {
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
  const [c1x, c1y] = control(p.sp, sx, sy, tx, ty)
  const [c2x, c2y] = control(p.tp, tx, ty, sx, sy)
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
  const src = useStore(s => s.nodeInternals.get(props.source))
  const tgt = useStore(s => s.nodeInternals.get(props.target))
  let ends: Ends = { sx: props.sourceX, sy: props.sourceY, tx: props.targetX, ty: props.targetY, sp: props.sourcePosition, tp: props.targetPosition }
  // Handles sit out-right / in-left, which only suits a target to the right. Otherwise
  // connect the facing sides: left↔right when the target is to the left, top↔bottom
  // when the boxes are stacked, so lines never loop behind or cross over the boxes.
  const a = src?.positionAbsolute, b = tgt?.positionAbsolute
  if (a && b && src?.width && src.height && tgt?.width && tgt.height) {
    const gap = 24
    const stacked = a.x < b.x + tgt.width + gap && b.x < a.x + src.width + gap
    const acx = a.x + src.width / 2, bcx = b.x + tgt.width / 2
    if (stacked) {
      const down = a.y < b.y
      ends = {
        sx: acx, sy: down ? a.y + src.height : a.y, sp: down ? Position.Bottom : Position.Top,
        tx: bcx, ty: down ? b.y : b.y + tgt.height, tp: down ? Position.Top : Position.Bottom,
      }
    } else if (acx > bcx) {
      ends = { sx: a.x, sy: a.y + src.height / 2, tx: b.x + tgt.width, ty: b.y + tgt.height / 2, sp: Position.Left, tp: Position.Right }
    }
  }
  const { path, mid, dir } = geometry(ends, data?.offset ?? 0, data?.parallel)
  let angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
  const reversed = angle > 90 || angle < -90
  if (reversed) angle += 180
  const sw = Number(style?.strokeWidth ?? 1.5)
  const color = data?.color ?? 'rgb(var(--fg))'
  const halo = { paintOrder: 'stroke' as const, stroke: 'rgb(var(--bg))', strokeWidth: 3, strokeLinejoin: 'round' as const }

  // Keep labels within the line's length so they never run over the boxes
  const room = Math.hypot(ends.tx - ends.sx, ends.ty - ends.sy) - 24
  const fit = (t: string, px: number) => {
    const max = Math.floor(room / px)
    return t.length <= max ? t : max < 4 ? '' : `${t.slice(0, max - 1).trimEnd()}…`
  }
  const l1 = data?.line1 ? fit(data.noArrowText ? data.line1 : `${reversed ? '← ' : ''}${data.line1}${reversed ? '' : ' →'}`, 6.4) : ''
  const l2 = data?.line2 ? fit(data.line2, 5.6) : ''

  // A bowed line (parallel or two-way) carries both lines on its outer side,
  // leaving the gap between neighbouring curves clear
  const off = data?.offset ?? 0
  let outerBelow = false
  if (off) {
    const len = Math.hypot(ends.tx - ends.sx, ends.ty - ends.sy) || 1
    const nx = (-(ends.ty - ends.sy) / len) * Math.sign(off), ny = ((ends.tx - ends.sx) / len) * Math.sign(off)
    const r = (angle * Math.PI) / 180
    outerBelow = nx * Math.sin(r) - ny * Math.cos(r) < 0 // bow direction vs the text's "up"
  }
  const y1 = outerBelow ? sw / 2 + 13 : -(sw / 2 + 5)
  const y2 = outerBelow ? sw / 2 + 26 : sw / 2 + 13
  const [ya, yb] = off && !outerBelow ? [-(sw / 2 + 18), -(sw / 2 + 5)] : [y1, y2]

  return (
    <>
      {data?.glow && (
        <path d={path} fill="none" style={{ stroke: String(style?.stroke ?? color), strokeWidth: sw + 8, strokeOpacity: 0.22, strokeLinecap: 'round', pointerEvents: 'none' }} />
      )}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={22} />
      {(l1 || l2) && (
        <g transform={`translate(${mid[0]} ${mid[1]}) rotate(${angle})`} style={{ cursor: 'pointer' }} textAnchor="middle">
          {l1 && <text y={ya} style={{ ...halo, fontSize: 11, fontWeight: data?.bold ? 700 : 500, fill: color }}>{l1}</text>}
          {l2 && <text y={yb} style={{ ...halo, fontSize: 10, fill: 'rgb(var(--muted))' }}>{l2}</text>}
        </g>
      )}
    </>
  )
}
