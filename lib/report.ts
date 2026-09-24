import { Chain, EdgeData, NodeData } from './types'
import { TaintResult } from './taint'
import { explorerAddressUrl, explorerTxUrl, fmtAmount } from './format'

// Printable investigation report (open in a new tab → Print → Save as PDF).
// Aimed at what exchanges and police ask for: where the funds went, which
// exchange deposit addresses received them, the tx hashes, and how each
// conclusion was reached.

function esc(s: unknown): string {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function date(ts: number) {
  return ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'unconfirmed'
}

export function buildReport(opts: {
  origin: string
  chain: Chain
  nodes: Map<string, NodeData>
  edges: EdgeData[]
  taint?: TaintResult | null
}): string {
  const { origin, chain, nodes, edges, taint } = opts
  const originNode = nodes.get(origin)
  const cashOut = [...nodes.values()].filter(n => n.label && ['exchange', 'deposit'].includes(n.label.type))
  const risky = [...nodes.values()].filter(n => (n.risk?.score ?? 0) >= 50 || (n.label && ['sanctioned', 'scam', 'hack', 'ransomware', 'mixer', 'coinjoin', 'darknet', 'illicit'].includes(n.label.type)))
  const inbound = (a: string) => edges.filter(e => e.target === a)
  const addr = (a: string) => `<a href="${esc(explorerAddressUrl(a, chain))}"><code>${esc(a)}</code></a>`
  const txs = (e: EdgeData) => (e.txids ?? [e.txid]).map(t => `<a href="${esc(explorerTxUrl(t, chain))}"><code>${esc(t.slice(0, 16))}…</code></a>`).join('<br>')

  const section = (title: string, body: string) => `<h2>${esc(title)}</h2>${body}`

  return `<!doctype html><html><head><meta charset="utf-8"><title>Trace report ${esc(origin.slice(0, 12))}</title>
<style>
body{font:13px/1.5 system-ui,sans-serif;color:#111;max-width:960px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f3f4f6}code{font-size:11px;word-break:break-all}a{color:#0645ad;text-decoration:none}
.muted{color:#666}.pill{display:inline-block;padding:0 6px;border-radius:8px;background:#eee;font-size:11px}
@media print{a{color:#111}}
</style></head><body>
<h1>Cryptocurrency trace report</h1>
<div class="muted">Generated ${esc(new Date().toISOString())} · ${chain.toUpperCase()} · CryptoTracer (open source)</div>

${section('Subject address', `<p>${addr(origin)}<br>
Label: ${esc(originNode?.label?.name ?? 'none')} · Risk: <b>${originNode?.risk?.score ?? '–'}/100 (${esc(originNode?.risk?.level ?? 'n/a')})</b></p>
<ul>${(originNode?.risk?.reasons ?? []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>`)}

${section('Funds reaching exchanges / exchange deposit addresses', cashOut.length ? `<p class="muted">Exchanges can identify the account holder behind a deposit address. Quote the deposit address and transaction hashes in any request.</p>
<table><tr><th>Address</th><th>Entity</th><th>Received (in this trace)</th><th>Transactions</th><th>Basis</th></tr>
${cashOut.map(n => {
  const ins = inbound(n.address)
  return `<tr><td>${addr(n.address)}</td><td>${esc(n.label!.name)} <span class="pill">${esc(n.label!.type)}</span></td>
<td>${ins.map(e => esc(fmtAmount(e.amount, e.asset, 8))).join('<br>') || '–'}</td><td>${ins.map(txs).join('<br>') || '–'}</td>
<td>${esc(n.label!.inferredBy ? `Inferred by ${n.label!.inferredBy} heuristic (confidence ${Math.round((n.label!.confidence ?? 0) * 100)}%)` : n.label!.source ?? 'label dataset')}</td></tr>`
}).join('')}</table>` : '<p class="muted">No exchange addresses in the traced graph yet.</p>')}

${taint ? section(`Taint analysis (${taint.method}, ${taint.asset})`, `<p>Source: ${taint.seeds.map(addr).join(', ')}. Based on ${taint.txsUsed} loaded transactions; unloaded activity is not counted, so figures are a lower bound.</p>
<table><tr><th>Address</th><th>Entity</th><th>Tainted received</th><th>Still held (est.)</th></tr>
${taint.reached.slice(0, 50).map(r => `<tr><td>${addr(r.address)}</td><td>${esc(nodes.get(r.address)?.label?.name ?? '')}</td><td>${esc(fmtAmount(r.received, taint.asset, 8))}</td><td>${esc(fmtAmount(r.remaining, taint.asset, 8))}</td></tr>`).join('')}
</table>`) : ''}

${risky.length ? section('High-risk addresses in the graph', `<table><tr><th>Address</th><th>Label</th><th>Risk</th><th>Reasons</th></tr>
${risky.map(n => `<tr><td>${addr(n.address)}</td><td>${esc(n.label?.name ?? '')}</td><td>${n.risk?.score ?? '–'}</td><td>${(n.risk?.reasons ?? []).map(esc).join('<br>')}</td></tr>`).join('')}</table>`) : ''}

${section('All traced flows', `<table><tr><th>From</th><th>To</th><th>Amount</th><th>Last seen</th><th>Transactions</th></tr>
${edges.map(e => `<tr><td>${addr(e.source)}<br><span class="muted">${esc(nodes.get(e.source)?.label?.name ?? '')}</span></td><td>${addr(e.target)}<br><span class="muted">${esc(nodes.get(e.target)?.label?.name ?? '')}</span></td>
<td>${esc(fmtAmount(e.amount, e.asset, 8))}${e.isChange ? ' <span class="pill">likely change</span>' : ''}</td><td>${esc(date(e.timestamp))}</td><td>${txs(e)}</td></tr>`).join('')}</table>`)}

${section('Method and limitations', `<p>Blockchain data from public APIs (Esplora for Bitcoin, Etherscan for Ethereum). Entity labels from GraphSense TagPacks, the US Treasury OFAC SDN list and curated entries; inferred labels (deposit addresses, clusters, change outputs, CoinJoins) are heuristic and carry a confidence score. Heuristics can be wrong: treat them as leads to verify, not proof. Full methodology: /methodology in this tool.</p>`)}
</body></html>`
}
