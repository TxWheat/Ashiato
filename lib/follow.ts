import { Chain, EntityLabel, EntityType, RawTransaction, transferKey } from './types'

// Follow-the-funds tracing. Unlike a "biggest counterparties" crawl, this
// tracks a specific amount ("lot") of money hop by hop:
//
//  BTC forward  – exact. The lot is a UTXO; we find the transaction that spent
//                 it and split the lot over that tx's outputs pro rata (haircut).
//  BTC backward – exact. The lot arrived in a known tx; its inputs are the sources.
//  ETH forward  – chronological. From the moment funds arrive, the next outflows
//                 (same asset) are allocated until the arrived amount is used up.
//  ETH backward – chronological. Before funds left, the most recent inflows are
//                 allocated until the amount is covered.
//
// ETH is account-based, so which outflow "is" the victim's money is a heuristic
// (explained on every hop); BTC is not.

export type Direction = 'forward' | 'backward'

export interface Lot {
  chain: Chain
  /** Forward: where the funds are now. Backward: where they arrived. */
  address: string
  asset: string
  amount: number
  /** Forward: arrival time. Backward: time the funds left `address` (ETH). */
  time: number
  /** Tx that delivered the lot to `address` */
  via?: string
  /** BTC forward: output index in `via` holding the funds */
  vout?: number
  hop: number
}

export interface TracedFlow {
  from: string
  to: string
  amount: number
  asset: string
  txid: string
  time: number
  hop: number
  reason: string
}

export type EndReason = 'unspent' | 'no-outflow' | 'no-source' | 'entity' | 'coinjoin' | 'max-hops' | 'not-loaded'

export interface TraceEnd {
  address: string
  amount: number
  asset: string
  reason: EndReason
  detail: string
}

export interface BtcTxInfo {
  tx: RawTransaction
  spentBy: (string | null)[]
  labels: Record<string, EntityLabel>
}

export interface FollowDeps {
  /** ETH: txs of `address`, loading older pages until `since` is covered */
  addressTxs: (address: string, since: number) => Promise<RawTransaction[]>
  btcTx: (txid: string) => Promise<BtcTxInfo>
  labelOf: (address: string) => EntityLabel | undefined
}

export interface FollowOptions {
  direction: Direction
  maxHops: number
  /** Keep at most this many branches per lot (largest first) */
  maxBranches: number
  /** Trail ends at these entity types */
  stopAt: EntityType[]
  /** Ignore branches smaller than this fraction of the starting amount */
  minFraction?: number
}

export interface FollowResult {
  flows: TracedFlow[]
  ends: TraceEnd[]
}

const HOUR = 3600

function duration(sec: number): string {
  const s = Math.abs(sec)
  if (s < HOUR) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 48 * HOUR) return `${(s / HOUR).toFixed(1)} h`
  return `${Math.round(s / 86400)} days`
}

function fmt(n: number, asset: string) {
  return `${+n.toPrecision(6)} ${asset}`
}

/** Gas makes ETH forwards slightly smaller than what arrived */
function tolerance(amount: number, asset: string) {
  return Math.max(amount * 0.01, asset === 'ETH' ? 0.002 : 0)
}

export async function followFunds(
  seeds: Lot[],
  opts: FollowOptions,
  deps: FollowDeps,
  onProgress?: (msg: string, partial: FollowResult) => void,
  isCancelled: () => boolean = () => false
): Promise<FollowResult> {
  const flows: TracedFlow[] = []
  const ends: TraceEnd[] = []
  const rootTotal = seeds.reduce((s, l) => s + l.amount, 0)
  const minAmount = rootTotal * (opts.minFraction ?? 0.002)
  const seen = new Set<string>()
  let frontier = seeds

  const stopFor = (l: Lot): boolean => {
    const label = deps.labelOf(l.address)
    if (label && opts.stopAt.includes(label.type) && l.hop > 0) {
      ends.push({ address: l.address, amount: l.amount, asset: l.asset, reason: 'entity', detail: `Reached ${label.name} (${label.type})` })
      return true
    }
    return false
  }

  while (frontier.length && !isCancelled()) {
    const next: Lot[] = []
    for (const lot of frontier) {
      if (isCancelled()) break
      const key = `${lot.address}|${lot.via ?? ''}|${lot.vout ?? ''}|${lot.time}`
      if (seen.has(key)) continue
      seen.add(key)
      if (stopFor(lot)) continue
      if (lot.hop >= opts.maxHops) {
        ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'max-hops', detail: 'Hop limit reached; continue from here' })
        continue
      }
      onProgress?.(`Hop ${lot.hop + 1}: ${lot.address.slice(0, 10)}…`, { flows, ends })

      let children: { lot: Lot; flow: TracedFlow }[] = []
      try {
        children =
          lot.chain === 'btc'
            ? opts.direction === 'forward' ? await btcForward(lot, deps, ends) : await btcBackward(lot, deps, ends)
            : opts.direction === 'forward' ? await ethForward(lot, deps, ends) : await ethBackward(lot, deps, ends)
      } catch (e) {
        ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'not-loaded', detail: e instanceof Error ? e.message : 'Failed to load' })
        continue
      }

      children = children
        .filter(c => c.flow.amount >= minAmount)
        .sort((a, b) => b.flow.amount - a.flow.amount)
        .slice(0, opts.maxBranches)
      for (const c of children) {
        flows.push(c.flow)
        next.push(c.lot)
      }
    }
    frontier = next
  }
  return { flows, ends }
}

// ── BTC ────────────────────────────────────────────────────────────────────

async function btcForward(lot: Lot, deps: FollowDeps, ends: TraceEnd[]) {
  if (!lot.via || lot.vout === undefined) throw new Error('No UTXO to follow')
  const holder = await deps.btcTx(lot.via)
  const k = holder.tx.outputs.findIndex(o => o.index === lot.vout)
  const spender = k >= 0 ? holder.spentBy[k] : null
  if (!spender) {
    ends.push({ address: lot.address, amount: lot.amount, asset: 'BTC', reason: 'unspent', detail: 'Coins are still unspent at this address' })
    return []
  }
  const { tx } = await deps.btcTx(spender)
  if (tx.coinjoin) {
    ends.push({ address: lot.address, amount: lot.amount, asset: 'BTC', reason: 'coinjoin', detail: `Entered a ${tx.coinjoin.kind} CoinJoin (${spender.slice(0, 10)}…); outputs are unlinkable` })
    return []
  }
  const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)
  if (totalIn <= 0) return []
  const share = lot.amount / totalIn
  const wait = tx.timestamp && lot.time ? `, ${duration(tx.timestamp - lot.time)} later` : ''
  const back = tx.outputs.filter(o => o.address === lot.address).reduce((s, o) => s + o.amount * share, 0)
  if (back > 0) {
    ends.push({ address: lot.address, amount: back, asset: 'BTC', reason: 'unspent', detail: `${fmt(back, 'BTC')} paid back to the same address as change` })
  }
  return tx.outputs
    .filter(o => o.amount > 0 && o.address !== lot.address)
    .map(o => {
      const amount = o.amount * share
      const change = o.isChange ? ' (likely change, same owner)' : ''
      return {
        lot: { chain: 'btc' as const, address: o.address, asset: 'BTC', amount, time: tx.timestamp, via: tx.txid, vout: o.index, hop: lot.hop + 1 },
        flow: {
          from: lot.address, to: o.address, amount, asset: 'BTC', txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
          reason: `Exact: the coins were spent in ${tx.txid.slice(0, 10)}…${wait}; ${(share * 100).toFixed(1)}% of that tx's inputs, split pro rata${change}`,
        },
      }
    })
}

async function btcBackward(lot: Lot, deps: FollowDeps, ends: TraceEnd[]) {
  if (!lot.via) throw new Error('No transaction to walk back from')
  const { tx } = await deps.btcTx(lot.via)
  if (tx.isCoinbase) {
    ends.push({ address: lot.address, amount: lot.amount, asset: 'BTC', reason: 'no-source', detail: 'Newly mined coins (coinbase)' })
    return []
  }
  if (tx.coinjoin) {
    ends.push({ address: lot.address, amount: lot.amount, asset: 'BTC', reason: 'coinjoin', detail: `Came out of a ${tx.coinjoin.kind} CoinJoin; inputs are unlinkable` })
    return []
  }
  const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)
  if (totalIn <= 0) return []
  return tx.inputs
    .filter(i => i.address !== lot.address)
    .map(i => {
      const amount = (lot.amount * i.amount) / totalIn
      const [ptx, pvout] = (i.prev ?? '').split(':')
      return {
        lot: { chain: 'btc' as const, address: i.address, asset: 'BTC', amount, time: tx.timestamp, via: ptx || undefined, vout: pvout ? +pvout : undefined, hop: lot.hop + 1 },
        flow: {
          from: i.address, to: lot.address, amount, asset: 'BTC', txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
          reason: `Exact: input of ${tx.txid.slice(0, 10)}… worth ${(i.amount / totalIn * 100).toFixed(1)}% of its inputs`,
        },
      }
    })
}

// ── ETH (account model) ────────────────────────────────────────────────────

async function ethForward(lot: Lot, deps: FollowDeps, ends: TraceEnd[]) {
  const txs = await deps.addressTxs(lot.address, lot.time)
  const outs = txs
    .filter(t => t.asset === lot.asset && t.inputs[0]?.address === lot.address && t.outputs[0]?.address !== lot.address)
    .filter(t => t.timestamp >= lot.time && t.txid !== lot.via && (t.outputs[0]?.amount ?? 0) > 0)
    .sort((a, b) => a.timestamp - b.timestamp)

  let remaining = lot.amount
  const tol = tolerance(lot.amount, lot.asset)
  const alloc = new Map<string, { amount: number; tx: RawTransaction; covered: number }>()
  for (const t of outs) {
    if (remaining <= tol) break
    const take = Math.min(remaining, t.outputs[0].amount)
    const to = t.outputs[0].address
    const key = `${to}|${transferKey(t)}`
    alloc.set(key, { amount: take, tx: t, covered: 0 })
    remaining -= take
  }
  if (alloc.size === 0) {
    ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'no-outflow', detail: `No ${lot.asset} left this address after the funds arrived (in loaded history)` })
    return []
  }
  if (remaining > tol) {
    ends.push({ address: lot.address, amount: remaining, asset: lot.asset, reason: 'no-outflow', detail: `${fmt(remaining, lot.asset)} not yet moved on (in loaded history)` })
  }
  return [...alloc.values()].map(({ amount, tx }) => ({
    lot: { chain: 'eth' as const, address: tx.outputs[0].address, asset: lot.asset, amount, time: tx.timestamp, via: tx.txid, hop: lot.hop + 1 },
    flow: {
      from: lot.address, to: tx.outputs[0].address, amount, asset: lot.asset, txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
      reason: `Next ${lot.asset} outflow ${duration(tx.timestamp - lot.time)} after ${fmt(lot.amount, lot.asset)} arrived; ${fmt(amount, lot.asset)} of ${fmt(tx.outputs[0].amount, lot.asset)} attributed`,
    },
  }))
}

async function ethBackward(lot: Lot, deps: FollowDeps, ends: TraceEnd[]) {
  // Look back up to a year before the funds left
  const txs = await deps.addressTxs(lot.address, lot.time - 365 * 86400)
  const ins = txs
    .filter(t => t.asset === lot.asset && t.outputs[0]?.address === lot.address && t.inputs[0]?.address !== lot.address)
    .filter(t => t.timestamp <= lot.time && t.txid !== lot.via && (t.outputs[0]?.amount ?? 0) > 0)
    .sort((a, b) => b.timestamp - a.timestamp)

  let remaining = lot.amount
  const tol = tolerance(lot.amount, lot.asset)
  const picked: { amount: number; tx: RawTransaction }[] = []
  for (const t of ins) {
    if (remaining <= tol) break
    const take = Math.min(remaining, t.outputs[0].amount)
    picked.push({ amount: take, tx: t })
    remaining -= take
  }
  if (!picked.length) {
    ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'no-source', detail: `No earlier ${lot.asset} inflow found (in loaded history)` })
    return []
  }
  return picked.map(({ amount, tx }) => ({
    lot: { chain: 'eth' as const, address: tx.inputs[0].address, asset: lot.asset, amount, time: tx.timestamp, via: tx.txid, hop: lot.hop + 1 },
    flow: {
      from: tx.inputs[0].address, to: lot.address, amount, asset: lot.asset, txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
      reason: `Most recent ${lot.asset} inflow ${duration(lot.time - tx.timestamp)} before the funds left; ${fmt(amount, lot.asset)} attributed`,
    },
  }))
}

// ── Seeds ──────────────────────────────────────────────────────────────────

/** Lots created by one transaction leaving `from` (optionally only to `to`) */
export function seedsFromTx(tx: RawTransaction, from: string, to?: string): { lots: Lot[]; flows: TracedFlow[] } {
  const lots: Lot[] = []
  const flows: TracedFlow[] = []
  const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)
  const mine = tx.inputs.filter(i => i.address === from).reduce((s, i) => s + i.amount, 0)
  const share = tx.chain === 'btc' && totalIn > 0 && mine > 0 ? mine / totalIn : 1
  for (const o of tx.outputs) {
    // Change outputs are followed too: the funds still left this address, and the
    // change guess can be wrong (it's a heuristic)
    if (o.address === from || o.amount <= 0 || (to && o.address !== to)) continue
    const amount = o.amount * share
    lots.push({ chain: tx.chain, address: o.address, asset: tx.asset, amount, time: tx.timestamp, via: tx.txid, vout: o.index, hop: 1 })
    flows.push({ from, to: o.address, amount, asset: tx.asset, txid: tx.txid, time: tx.timestamp, hop: 1, reason: o.isChange ? 'Starting transaction (likely change, same owner)' : 'Starting transaction' })
  }
  return { lots, flows }
}

/** Backward seeds: the funds that arrived at `to` in `tx` (optionally only from `from`) */
export function backSeedsFromTx(tx: RawTransaction, to: string, from?: string): { lots: Lot[]; flows: TracedFlow[] } {
  const received = tx.outputs.filter(o => o.address === to).reduce((s, o) => s + o.amount, 0)
  if (received <= 0) return { lots: [], flows: [] }
  if (tx.chain === 'btc') {
    // Walk back from the receiving side; the engine turns the inputs into flows
    const lot: Lot = { chain: 'btc', address: to, asset: 'BTC', amount: received, time: tx.timestamp, via: tx.txid, hop: 0 }
    if (from) {
      const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)
      const fromIn = tx.inputs.filter(i => i.address === from).reduce((s, i) => s + i.amount, 0)
      lot.amount = totalIn > 0 ? (received * fromIn) / totalIn : received
    }
    return { lots: [lot], flows: [] }
  }
  const sender = tx.inputs[0]?.address
  if (!sender || (from && sender !== from)) return { lots: [], flows: [] }
  return {
    lots: [{ chain: 'eth', address: sender, asset: tx.asset, amount: received, time: tx.timestamp, via: tx.txid, hop: 1 }],
    flows: [{ from: sender, to, amount: received, asset: tx.asset, txid: tx.txid, time: tx.timestamp, hop: 1, reason: 'Starting transaction' }],
  }
}
