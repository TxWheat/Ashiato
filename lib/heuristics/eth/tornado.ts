import { EntityLabel, Finding, RawTransaction } from '../../types'

// Tornado Cash reveals, re-implemented from the ideas in pareto-xyz/tutela-app:
//  - Address match: the same address deposits to and withdraws from a pool.
//  - Unique gas price: a deposit and a withdrawal sharing an unusual gas price.
//  - Multi-denomination: one address's deposit mix (e.g. 3×1 ETH + 2×0.1 ETH)
//    equals another address's withdrawal mix.
// Tutela ran these over the full pool history in BigQuery; here they run over
// whatever transactions are loaded in the investigation.

export interface TornadoEvent {
  address: string
  pool: string
  poolName: string
  txid: string
  timestamp: number
  gasPriceGwei?: number
}

export function isTornado(label: EntityLabel | undefined): boolean {
  return !!label && label.type === 'mixer' && /tornado/i.test(label.name)
}

/** Deposits made by and withdrawals received by any address in `txs` */
export function tornadoEvents(txs: RawTransaction[], labelOf: (a: string) => EntityLabel | undefined) {
  const deposits: TornadoEvent[] = []
  const withdrawals: TornadoEvent[] = []
  const seen = new Set<string>()
  for (const tx of txs) {
    const key = `${tx.txid}:${tx.kind}:${tx.asset}`
    if (seen.has(key)) continue
    seen.add(key)
    const from = tx.inputs[0]?.address
    const to = tx.outputs[0]?.address
    const amount = tx.outputs[0]?.amount ?? 0
    if (!from || !to) continue
    const toL = labelOf(to)
    const fromL = labelOf(from)
    if (isTornado(toL) && amount > 0 && tx.kind !== 'internal') {
      deposits.push({ address: from, pool: to, poolName: toL!.name, txid: tx.txid, timestamp: tx.timestamp, gasPriceGwei: tx.gasPriceGwei })
    } else if (isTornado(fromL) && amount > 0) {
      withdrawals.push({ address: to, pool: from, poolName: fromL!.name, txid: tx.txid, timestamp: tx.timestamp, gasPriceGwei: tx.gasPriceGwei })
    }
  }
  return { deposits, withdrawals }
}

/** A gas price is a fingerprint when it is not a round number of gwei */
function unusualGas(g?: number): boolean {
  if (!g) return false
  const decimals = (g.toString().split('.')[1] ?? '').length
  return decimals >= 3
}

/** Per-address findings for a single address */
export function tornadoFindings(
  address: string,
  txs: RawTransaction[],
  labelOf: (a: string) => EntityLabel | undefined
): Finding[] {
  const { deposits, withdrawals } = tornadoEvents(txs, labelOf)
  const myDeps = deposits.filter(d => d.address === address)
  const myWds = withdrawals.filter(w => w.address === address)
  const out: Finding[] = []
  if (myDeps.length || myWds.length) {
    out.push({
      heuristic: 'tornado-usage',
      confidence: 1,
      reasons: [
        myDeps.length ? `${myDeps.length} deposit(s) into Tornado Cash (${[...new Set(myDeps.map(d => d.poolName))].join(', ')})` : '',
        myWds.length ? `${myWds.length} withdrawal(s) from Tornado Cash (${[...new Set(myWds.map(w => w.poolName))].join(', ')})` : '',
      ].filter(Boolean),
    })
  }
  const reused = myWds.filter(w => myDeps.some(d => d.pool === w.pool && d.timestamp < w.timestamp))
  if (reused.length) {
    out.push({
      heuristic: 'tornado-address-match',
      confidence: 0.9,
      reasons: [`Deposited to and later withdrew from the same pool with the same address (${reused.length}×): these mixes are linkable`],
    })
  }
  const fp = myDeps.filter(d => unusualGas(d.gasPriceGwei))
  if (fp.length) {
    out.push({
      heuristic: 'tornado-gas-fingerprint',
      confidence: 0.5,
      reasons: fp.slice(0, 3).map(d => `Deposit ${d.txid.slice(0, 10)}… used an unusual gas price (${d.gasPriceGwei} gwei); a withdrawal with the same gas price would be linkable`),
    })
  }
  return out
}

export interface TornadoLink {
  depositor: string
  withdrawer: string
  heuristic: 'tornado-gas-price' | 'tornado-multi-denomination'
  confidence: number
  reason: string
}

/** Cross-address links over everything loaded in the investigation */
export function tornadoLinks(txs: RawTransaction[], labelOf: (a: string) => EntityLabel | undefined): TornadoLink[] {
  const { deposits, withdrawals } = tornadoEvents(txs, labelOf)
  const links: TornadoLink[] = []

  // Unique gas price (same pool, withdrawal after deposit, different address)
  for (const d of deposits) {
    if (!unusualGas(d.gasPriceGwei)) continue
    for (const w of withdrawals) {
      if (w.pool === d.pool && w.address !== d.address && w.timestamp > d.timestamp && w.gasPriceGwei === d.gasPriceGwei) {
        links.push({
          depositor: d.address,
          withdrawer: w.address,
          heuristic: 'tornado-gas-price',
          confidence: 0.7,
          reason: `Deposit and withdrawal in ${d.poolName} share the unusual gas price ${d.gasPriceGwei} gwei`,
        })
      }
    }
  }

  // Multi-denomination portfolio match
  const portfolio = (events: TornadoEvent[]) => {
    const m = new Map<string, Map<string, number>>()
    for (const e of events) {
      const p = m.get(e.address) ?? new Map()
      p.set(e.poolName, (p.get(e.poolName) ?? 0) + 1)
      m.set(e.address, p)
    }
    return m
  }
  const sig = (p: Map<string, number>) => [...p.entries()].sort().map(([k, v]) => `${v}×${k}`).join(' + ')
  const depP = portfolio(deposits)
  const wdP = portfolio(withdrawals)
  for (const [dep, dp] of depP) {
    if (dp.size < 2) continue // multi-denomination only
    const s = sig(dp)
    for (const [wd, wp] of wdP) {
      if (wd !== dep && sig(wp) === s) {
        links.push({
          depositor: dep,
          withdrawer: wd,
          heuristic: 'tornado-multi-denomination',
          confidence: 0.6,
          reason: `Identical multi-pool pattern: deposited ${s}, withdrew ${s}`,
        })
      }
    }
  }
  return links
}
