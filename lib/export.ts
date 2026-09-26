import { Chain, EdgeData, NodeData, RawTransaction, TxLookup } from './types'
import type { CheckedPayment } from './client-payments'
import type { TracedFlow, TraceEnd } from './follow'
import type { CrossChainHop } from './bridges/types'

// Case files and exports: JSON (save/load an investigation), CSV of flows,
// GraphML (Gephi / yEd / Cytoscape, as in s0md3v/Orbit).

export const CASE_VERSION = 1

export interface LoadedPage {
  rawTxs: RawTransaction[]
  nextCursor?: string
  warnings?: string[]
  /** Saved without its full history (only what the graph uses): reload it when opened */
  trimmed?: boolean
}

export interface CaseFile {
  version: number
  savedAt: string
  /** For a transaction case, `address` holds the txid */
  origin: { address: string; chain: Chain }
  originKind?: 'address' | 'tx'
  hubs?: TxLookup[]
  /** Every address seen, with labels, risk and notes */
  known: NodeData[]
  /** Addresses shown on the graph */
  visible: string[]
  pages: Record<string, LoadedPage>
  followedPairs: string[]
  traced?: TracedFlow[]
  traceEnds?: TraceEnd[]
  /** Node positions on the canvas, so a reopened chart keeps its layout */
  positions?: Record<string, { x: number; y: number }>
  /** Transactions drawn as their own lines */
  itemizedIds?: string[]
  /** Links (address pairs) the user hid from the graph */
  hiddenLinks?: string[]
  /** What the client said they paid, and whether it checked out on-chain */
  clientPayments?: CheckedPayment[]
  /** Cross-chain swaps added to the graph; `via` is the service's node it leaves from */
  bridgeHops?: (CrossChainHop & { via: string; sender?: string; bridge?: string })[]
}

/**
 * A case small enough for account storage: each address keeps only the transactions the
 * graph uses (links between addresses on it, traced and itemized ones). The rest of its
 * history is re-downloaded when the address is opened.
 */
export function slimCase(c: CaseFile): CaseFile {
  const onGraph = new Set(c.visible)
  // Itemized edge ids start with their txid ("txid|event|from|to|asset")
  const keepTx = new Set([
    ...(c.traced ?? []).map(f => f.txid),
    ...(c.hubs ?? []).map(h => h.txid),
    ...(c.itemizedIds ?? []).map(id => id.split('|')[0]),
  ])
  const pages: Record<string, LoadedPage> = {}
  for (const [addr, page] of Object.entries(c.pages)) {
    if (!onGraph.has(addr)) continue
    const rawTxs = page.rawTxs.filter(t =>
      keepTx.has(t.txid) ||
      [...t.inputs, ...t.outputs].some(io => io.address !== addr && onGraph.has(io.address)))
    pages[addr] = { ...page, rawTxs, trimmed: page.trimmed || rawTxs.length < page.rawTxs.length }
  }
  return { ...c, pages }
}

export function parseCase(text: string): CaseFile {
  const c = JSON.parse(text) as CaseFile
  if (c.version !== CASE_VERSION || !c.origin?.address || !Array.isArray(c.known) || !Array.isArray(c.visible) || typeof c.pages !== 'object') {
    throw new Error('Not a valid case file')
  }
  return c
}

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  // Neutralise spreadsheet formula injection from on-chain strings (token symbols, labels)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function flowsToCsv(
  nodes: Map<string, NodeData>,
  edges: EdgeData[]
): string {
  const header = ['from', 'from_label', 'to', 'to_label', 'asset', 'amount', 'tx_count', 'last_seen_utc', 'likely_change', 'txids']
  const rows = edges.map(e => [
    e.source,
    nodes.get(e.source)?.label?.name ?? '',
    e.target,
    nodes.get(e.target)?.label?.name ?? '',
    e.asset,
    e.amount,
    e.txCount ?? 1,
    e.timestamp ? new Date(e.timestamp * 1000).toISOString() : '',
    e.isChange ? 'yes' : '',
    (e.txids ?? [e.txid]).join(' '),
  ])
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
}

function xml(s: unknown): string {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

export function toGraphml(nodes: NodeData[], edges: EdgeData[]): string {
  const ids = new Set(nodes.map(n => n.address))
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="risk" for="node" attr.name="risk" attr.type="int"/>
  <key id="chain" for="node" attr.name="chain" attr.type="string"/>
  <key id="amount" for="edge" attr.name="amount" attr.type="double"/>
  <key id="asset" for="edge" attr.name="asset" attr.type="string"/>
  <key id="txcount" for="edge" attr.name="tx_count" attr.type="int"/>
  <graph id="trace" edgedefault="directed">
${nodes.map(n => `    <node id="${xml(n.address)}"><data key="label">${xml(n.label?.name ?? n.address)}</data><data key="type">${xml(n.label?.type ?? 'unknown')}</data><data key="risk">${n.risk?.score ?? 0}</data><data key="chain">${n.chain}</data></node>`).join('\n')}
${edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => `    <edge source="${xml(e.source)}" target="${xml(e.target)}"><data key="amount">${e.amount}</data><data key="asset">${xml(e.asset)}</data><data key="txcount">${e.txCount ?? 1}</data></edge>`).join('\n')}
  </graph>
</graphml>
`
}

export function download(filename: string, content: string | Blob, type = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
