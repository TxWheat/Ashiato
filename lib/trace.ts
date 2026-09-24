import 'server-only'
import { Chain, EntityLabel, Finding, RawTransaction, TraceResult } from './types'
import { getLabel } from './labels'
import { buildGraph } from './graph'
import { detectDepositAddress } from './heuristics/deposit'
import { tornadoFindings } from './heuristics/eth/tornado'
import { scoreRisk } from './risk'

/** Labels, heuristics, risk and graph for one page of an address's transactions */
export function assemble(opts: {
  address: string
  chain: Chain
  balance: number
  txCount: number
  rawTxs: RawTransaction[]
  nextCursor?: string
  warnings?: string[]
}): TraceResult {
  const { address, chain, rawTxs } = opts
  const labelCache = new Map<string, EntityLabel | undefined>()
  const labelOf = (a: string) => {
    if (!labelCache.has(a)) labelCache.set(a, getLabel(a, chain))
    return labelCache.get(a)
  }

  const findings: Finding[] = []
  let entity = labelOf(address)

  const deposit = detectDepositAddress(address, chain, rawTxs, labelOf)
  if (deposit) {
    findings.push(deposit)
    if (!entity) {
      entity = deposit.label
      labelCache.set(address, entity)
    }
  }

  if (chain === 'eth') findings.push(...tornadoFindings(address, rawTxs, labelOf))

  const cj = rawTxs.filter(t => t.coinjoin && t.inputs.some(i => i.address === address))
  if (cj.length) {
    findings.push({
      heuristic: 'coinjoin-participant',
      confidence: Math.max(...cj.map(t => t.coinjoin!.confidence)),
      reasons: cj.slice(0, 3).map(t => `${t.coinjoin!.kind} CoinJoin ${t.txid.slice(0, 10)}…: ${t.coinjoin!.reasons[0]}`),
    })
  }

  const risk = scoreRisk(address, entity, rawTxs, labelOf, findings)
  const { nodes, edges } = buildGraph(address, chain, rawTxs, labelOf)
  const origin = {
    address, chain, label: entity, balance: opts.balance, txCount: opts.txCount,
    isOrigin: true, risk, findings,
  }

  return {
    address,
    chain,
    balance: opts.balance,
    txCount: opts.txCount,
    nodes: [origin, ...nodes.filter(n => n.address !== address)],
    edges,
    entity,
    rawTxs,
    nextCursor: opts.nextCursor,
    findings,
    risk,
    warnings: opts.warnings?.length ? opts.warnings : undefined,
  }
}
