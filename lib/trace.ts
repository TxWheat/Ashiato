import 'server-only'
import { Chain, EntityLabel, Finding, NodeData, RawTransaction, TraceResult } from './types'
import { getLabel } from './labels'
import { buildGraph } from './graph'
import { detectDepositAddress } from './heuristics/deposit'
import { tornadoFindings } from './heuristics/eth/tornado'
import { scoreRisk } from './risk'
import { lookupEnsNames } from './ens'
import { detectPoisoning } from './heuristics/eth/poisoning'

/** Labels, heuristics, risk and graph for one page of an address's transactions */
export async function assemble(opts: {
  address: string
  chain: Chain
  balance: number
  txCount: number
  rawTxs: RawTransaction[]
  nextCursor?: string
  warnings?: string[]
  /** Online label (e.g. Etherscan name tag) for the address itself when the offline files have none */
  extraLabel?: EntityLabel
  /** Online labels (e.g. Tronscan tags) for counterparties the offline files don't know */
  extraLabels?: Map<string, EntityLabel>
}): Promise<TraceResult> {
  const { address, chain, rawTxs } = opts
  const labelCache = new Map<string, EntityLabel | undefined>()
  const labelOf = (a: string) => {
    if (!labelCache.has(a)) labelCache.set(a, getLabel(a, chain))
    return labelCache.get(a)
  }

  const findings: Finding[] = []
  if (opts.extraLabel && !labelOf(address)) labelCache.set(address, opts.extraLabel)
  for (const [a, l] of opts.extraLabels ?? []) if (!labelOf(a)) labelCache.set(a, l)
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
  if (chain === 'eth' || chain === 'tron') {
    const poison = detectPoisoning(address, rawTxs)
    for (const [a, l] of poison.labels) if (!labelOf(a)) labelCache.set(a, l)
    if (poison.finding) findings.push(poison.finding)
  }

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
  const origin: NodeData = {
    address, chain, label: entity, balance: opts.balance, txCount: opts.txCount,
    isOrigin: true, risk, findings,
  }

  if (chain === 'eth') {
    const ens = await lookupEnsNames([address, ...nodes.map(n => n.address)])
    for (const n of [origin, ...nodes]) {
      const name = ens.get(n.address)
      if (name) n.ens = name
    }
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
