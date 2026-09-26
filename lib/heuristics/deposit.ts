import { Chain, EntityLabel, Finding, RawTransaction } from '../types'
import { isEvm } from '../evm'

// Exchange deposit-address detection.
//
// Exchanges give every customer a unique deposit address which, shortly after
// receiving funds, forwards ("sweeps") them to an exchange hot wallet. Finding
// the deposit address is what lets a victim or investigator ask the exchange
// to identify the account holder.
//
// ETH follows tutela's / Victor (FC'20) rule: an inbound transfer of amount a
// followed within ~3200 blocks (~12h) by an outbound transfer of a − ε
// (0 ≤ ε ≤ 0.01 ETH) to a known exchange. BTC uses the sweep pattern: every
// spend from the address sends (almost) everything to one known exchange.

const WINDOW_SECONDS = 12 * 3600

export interface DepositFinding extends Finding {
  exchange: string
  label: EntityLabel
}

function tolerance(asset: string, amount: number): number {
  if (asset === 'ETH') return 0.01
  return Math.max(amount * 0.01, 1e-6)
}

export function detectDepositAddress(
  address: string,
  chain: Chain,
  txs: RawTransaction[],
  labelOf: (addr: string) => EntityLabel | undefined
): DepositFinding | undefined {
  const own = labelOf(address)
  if (own && own.type !== 'deposit' && own.type !== 'unknown' && own.type !== 'wallet') return undefined

  // Outbound flows from `address`, grouped by recipient exchange
  const outByExchange = new Map<string, { value: number; count: number }>()
  let outTotal = 0
  let matched = 0
  const reasons: string[] = []

  for (const tx of txs) {
    const fromUs = tx.inputs.some(i => i.address === address)
    if (!fromUs) continue
    for (const o of tx.outputs) {
      if (o.address === address) continue
      outTotal += o.amount
      const l = labelOf(o.address)
      if (l?.type !== 'exchange') continue
      const e = outByExchange.get(l.name) ?? { value: 0, count: 0 }
      e.value += o.amount
      e.count++
      outByExchange.set(l.name, e)

      if (isEvm(chain)) {
        // Look for the matching inbound transfer just before this forward
        const tol = tolerance(tx.asset, o.amount)
        const inbound = txs.find(
          t =>
            t.asset === tx.asset &&
            t.timestamp <= tx.timestamp &&
            tx.timestamp - t.timestamp <= WINDOW_SECONDS &&
            t.outputs.some(x => x.address === address && x.amount - o.amount >= 0 && x.amount - o.amount <= tol) &&
            !t.inputs.some(i => i.address === address)
        )
        if (inbound) {
          matched++
          if (reasons.length < 3) {
            const hrs = ((tx.timestamp - inbound.timestamp) / 3600).toFixed(1)
            const got = inbound.outputs.find(x => x.address === address)!.amount
            reasons.push(`Received ${+got.toFixed(6)} ${tx.asset}, forwarded ${+o.amount.toFixed(6)} to ${l.name} ${hrs}h later`)
          }
        }
      }
    }
  }

  if (outByExchange.size !== 1 || outTotal <= 0) return undefined
  const [exchange, flow] = [...outByExchange.entries()][0]
  const share = flow.value / outTotal
  if (share < 0.8) return undefined

  let confidence: number
  if (isEvm(chain)) {
    if (matched === 0) {
      if (flow.count < 2 || share < 0.95) return undefined
      confidence = 0.5
      reasons.push(`${flow.count} outbound transfers, ${(share * 100).toFixed(0)}% of value to ${exchange}`)
    } else {
      confidence = Math.min(0.9, 0.6 + 0.1 * matched)
    }
  } else {
    confidence = Math.min(0.85, 0.55 + 0.1 * flow.count)
    reasons.push(`${(share * 100).toFixed(0)}% of spent value swept to ${exchange} across ${flow.count} output(s)`)
  }
  reasons.push(`All outbound value goes to a single exchange (${exchange})`)

  return {
    heuristic: 'deposit-address',
    confidence,
    reasons,
    exchange,
    label: {
      name: `Deposit address → ${exchange}`,
      type: 'deposit',
      inferredBy: 'deposit-address',
      confidence,
    },
  }
}
