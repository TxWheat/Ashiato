import { EntityLabel, EntityType, Finding, RawTransaction, RiskLevel, RiskResult } from './types'

// 0–100 risk score with reasons, after peterzen/heuristic's model:
// clean <8 · low 8–25 · medium 25–50 · high 50–75 · critical 75+.
// Score = max(own-label score, strongest direct-exposure score, behaviour flags).

const SELF: Partial<Record<EntityType, number>> = {
  sanctioned: 100, illicit: 95, ransomware: 95, hack: 90, scam: 90, darknet: 85,
  mixer: 70, coinjoin: 55, gambling: 30,
}

const EXPOSURE_WEIGHT: Partial<Record<EntityType, number>> = {
  sanctioned: 1, illicit: 1, ransomware: 0.9, hack: 0.85, scam: 0.85, darknet: 0.8,
  mixer: 0.7, coinjoin: 0.5, gambling: 0.25,
}

// Any direct contact with these is at least this serious, however small the share
const EXPOSURE_FLOOR: Partial<Record<EntityType, number>> = { sanctioned: 60, illicit: 60, ransomware: 50 }

export function riskLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 25) return 'medium'
  if (score >= 8) return 'low'
  return 'clean'
}

export function scoreRisk(
  address: string,
  label: EntityLabel | undefined,
  txs: RawTransaction[],
  labelOf: (a: string) => EntityLabel | undefined,
  findings: Finding[] = []
): RiskResult {
  const reasons: string[] = []
  let score = 0

  if (label && SELF[label.type] !== undefined) {
    score = SELF[label.type]!
    reasons.push(`Address is labelled ${label.type}: ${label.name}`)
  }

  // Direct exposure by value, per asset so units are never mixed
  const total = new Map<string, number>() // asset → value in/out
  const risky = new Map<string, Map<EntityType, { value: number; names: Set<string> }>>()
  for (const tx of txs) {
    const sent = tx.inputs.some(i => i.address === address)
    const received = tx.outputs.some(o => o.address === address)
    const counterparties: { address: string; amount: number }[] = []
    if (sent) for (const o of tx.outputs) if (o.address !== address && !o.isChange) counterparties.push(o)
    if (received) {
      const got = tx.outputs.filter(o => o.address === address).reduce((s, o) => s + o.amount, 0)
      const ins = tx.inputs.filter(i => i.address !== address)
      const inTotal = ins.reduce((s, i) => s + i.amount, 0) || 1
      // BTC inputs carry their own value; ETH inputs don't, so split evenly
      for (const i of ins) counterparties.push({ address: i.address, amount: i.amount ? (got * i.amount) / inTotal : got / ins.length })
    }
    // Fake-token transfers (address poisoning) move no real value and say nothing about this address
    if (tx.asset.endsWith('*')) continue
    for (const c of counterparties) {
      total.set(tx.asset, (total.get(tx.asset) ?? 0) + c.amount)
      const l = labelOf(c.address)
      if (!l || l.inferredBy === 'address-poisoning' || EXPOSURE_WEIGHT[l.type] === undefined) continue
      const byType = risky.get(tx.asset) ?? new Map()
      const e = byType.get(l.type) ?? { value: 0, names: new Set<string>() }
      e.value += c.amount
      e.names.add(l.name)
      byType.set(l.type, e)
      risky.set(tx.asset, byType)
    }
  }

  const exposures: { type: EntityType; share: number; asset: string; names: Set<string>; s: number }[] = []
  for (const [asset, byType] of risky) {
    const t = total.get(asset) || 1
    for (const [type, e] of byType) {
      const share = Math.min(1, e.value / t)
      const s = Math.max(EXPOSURE_FLOOR[type] ?? 0, EXPOSURE_WEIGHT[type]! * 100 * (0.35 + 0.65 * share))
      exposures.push({ type, share, asset, names: e.names, s })
    }
  }
  exposures.sort((a, b) => b.s - a.s)
  for (const e of exposures.slice(0, 4)) {
    reasons.push(
      `Direct exposure to ${e.type} (${[...e.names].slice(0, 2).join(', ')}): ${(e.share * 100).toFixed(1)}% of loaded ${e.asset} flow`
    )
  }
  if (exposures[0]) score = Math.max(score, exposures[0].s)

  // Behaviour
  const joined = txs.filter(t => t.coinjoin && t.inputs.some(i => i.address === address))
  if (joined.length) {
    score = Math.max(score, 45)
    reasons.push(`Took part in ${joined.length} CoinJoin transaction(s) (${[...new Set(joined.map(t => t.coinjoin!.kind))].join(', ')})`)
  }
  for (const f of findings) {
    if (f.heuristic === 'tornado-usage') {
      score = Math.max(score, 60)
      reasons.push(...f.reasons)
    }
  }

  score = Math.round(Math.min(100, score))
  if (reasons.length === 0) reasons.push('No risky labels or exposure found in the loaded transactions')
  return { score, level: riskLevel(score), reasons }
}
