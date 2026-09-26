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
  /** Traced funds' share of the pool they moved in at this hop (0–1); absent = not pooled */
  share?: number
  /** The funds were swapped in this transaction (e.g. SHIB → ETH on a DEX): what came back */
  swap?: { asset: string; amount: number }
}

export type EndReason = 'unspent' | 'no-outflow' | 'no-source' | 'entity' | 'coinjoin' | 'max-hops' | 'not-loaded' | 'peel' | 'split' | 'diluted'

export interface TraceEnd {
  address: string
  amount: number
  asset: string
  reason: EndReason
  detail: string
  /** diluted: the traced funds' share of the pool where the trail stopped */
  share?: number
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
  /** Trail also ends at labels this accepts (e.g. cross-chain swap services, by name) */
  stopWhen?: (label: EntityLabel) => boolean
  /** Ignore branches smaller than this fraction of the starting amount */
  minFraction?: number
  /**
   * Adaptive (default): read each transaction's shape and follow the trail, not
   * every output. Peels follow the remainder, splits the main outputs, ETH
   * prefers a same-amount pass-through. Off: every output, pro rata, up to maxBranches.
   */
  adaptive?: boolean
  /**
   * Stop when the traced funds are less than this share (0–1) of the pool they move
   * in, e.g. 0.35: once the client's money is under 35% of a mixed transaction or
   * wallet balance, the onward trail is no longer meaningfully theirs.
   */
  minShare?: number
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
  const adaptive = opts.adaptive !== false
  const minAmount = rootTotal * (opts.minFraction ?? (adaptive ? 0.02 : 0.002))
  // The dust threshold is in the traced asset; after a swap it converts at the swap's rate
  const minFor = new Map<string, number>(seeds.map(l => [l.asset, minAmount]))
  const minOf = (asset: string) => minFor.get(asset) ?? minAmount
  const seen = new Set<string>()
  let frontier = seeds

  const stopFor = (l: Lot): boolean => {
    const label = deps.labelOf(l.address)
    if (label && (opts.stopAt.includes(label.type) || opts.stopWhen?.(label)) && l.hop > 0) {
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
            ? opts.direction === 'forward' ? await btcForward(lot, deps, ends, adaptive ? opts.stopAt : null, opts.minShare ?? 0) : await btcBackward(lot, deps, ends)
            : opts.direction === 'forward' ? await ethForward(lot, deps, ends, adaptive, opts.minShare ?? 0) : await ethBackward(lot, deps, ends, adaptive)
      } catch (e) {
        ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'not-loaded', detail: e instanceof Error ? e.message : 'Failed to load' })
        continue
      }

      for (const c of children) {
        if (c.flow.swap && !minFor.has(c.flow.swap.asset) && c.flow.amount > 0) {
          minFor.set(c.flow.swap.asset, minOf(c.flow.asset) * (c.flow.swap.amount / c.flow.amount))
        }
      }
      children = children
        .filter(c => c.flow.amount >= minOf(c.flow.asset))
        .sort((a, b) => b.flow.amount - a.flow.amount)
      if (adaptive && lot.chain !== 'btc' && children.length > 1) {
        // Main trail: side branches carrying under MAIN_SHARE of this lot are noted, not followed
        // (unless they land at an exchange or other stop: that's worth seeing)
        const reaches = (c: { lot: Lot }) => { const l = deps.labelOf(c.lot.address); return !!l && (opts.stopAt.includes(l.type) || !!opts.stopWhen?.(l)) }
        const isSide = (c: { lot: Lot; flow: TracedFlow }) => c.flow.amount < lot.amount * MAIN_SHARE && !reaches(c)
        const side = children.filter(isSide)
        if (side.length && side.length < children.length) {
          children = children.filter(c => !isSide(c))
          const total = side.reduce((sum, c) => sum + c.flow.amount, 0)
          ends.push({
            address: lot.address, amount: total, asset: lot.asset, reason: 'split',
            detail: `${side.length} smaller branch${side.length === 1 ? '' : 'es'} (each under ${pct(MAIN_SHARE)} of the traced ${fmt(lot.amount, lot.asset)}) totalling ${fmt(total, lot.asset)}, not followed: the main trail is the larger move`,
          })
        }
      }
      children = children.slice(0, adaptive ? Math.min(opts.maxBranches, 3) : opts.maxBranches)
      for (const c of children) {
        // Change paid back to the same address continues there without drawing a self-loop
        if (c.flow.from !== c.flow.to) flows.push(c.flow)
        next.push(c.lot)
      }
    }
    frontier = next
  }
  return { flows, ends }
}

// ── BTC ────────────────────────────────────────────────────────────────────

// ── BTC spend classification ───────────────────────────────────────────────

export type SpendShape = 'sweep' | 'peel' | 'pair' | 'split'

export interface SpendPlan {
  shape: SpendShape
  /** Indexes into tx.outputs to follow (may include an output back to the holder) */
  follow: number[]
  /** Outputs deliberately not followed (peeled payments, small splits) */
  side: number[]
  note: string
}

/**
 * Reads what kind of spend a transaction is, from the holder's point of view:
 *  - sweep: everything into one output → follow it
 *  - peel:  a small payment peeled off, a much larger remainder moves on → follow the remainder
 *  - pair:  two comparable outputs → follow both
 *  - split: three or more outputs → follow the largest covering ~80% of the value
 */
export function planBtcSpend(tx: RawTransaction): SpendPlan {
  const outs = tx.outputs.map((o, k) => ({ o, k })).filter(x => x.o.amount > 0)
  if (outs.length <= 1) return { shape: 'sweep', follow: outs.map(x => x.k), side: [], note: 'swept into a single output' }
  const byAmount = [...outs].sort((a, b) => b.o.amount - a.o.amount)
  const total = outs.reduce((s, x) => s + x.o.amount, 0)
  const fewInputs = new Set(tx.inputs.map(i => i.address)).size <= 2
  if (outs.length === 2) {
    const [big, small] = byAmount
    if (fewInputs && big.o.amount >= 3 * small.o.amount) {
      return {
        shape: 'peel', follow: [big.k], side: [small.k],
        note: `peel chain: ${fmt(small.o.amount, 'BTC')} peeled off, the ${fmt(big.o.amount, 'BTC')} remainder moved on`,
      }
    }
    return { shape: 'pair', follow: [big.k, small.k], side: [], note: 'split into two comparable outputs; both followed' }
  }
  const follow: number[] = []
  let covered = 0
  for (const x of byAmount) {
    if (follow.length >= 3 || covered >= total * 0.8) break
    follow.push(x.k)
    covered += x.o.amount
  }
  const side = byAmount.map(x => x.k).filter(k => !follow.includes(k))
  return { shape: 'split', follow, side, note: `split into ${outs.length} outputs; the ${follow.length} largest (${Math.round((covered / total) * 100)}% of the value) followed` }
}

const pct = (x: number) => `${Math.round(x * 100)}%`

async function btcForward(lot: Lot, deps: FollowDeps, ends: TraceEnd[], adaptiveStopAt: EntityType[] | null, minShare = 0) {
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
  const share = Math.min(1, lot.amount / totalIn)
  if (share < minShare) {
    ends.push({
      address: lot.address, amount: lot.amount, asset: 'BTC', reason: 'diluted', share,
      detail: `Pooled: the traced ${fmt(lot.amount, 'BTC')} was only ${pct(share)} of the ${fmt(totalIn, 'BTC')} spent together in ${tx.txid.slice(0, 10)}… (below the ${pct(minShare)} cut-off)`,
    })
    return []
  }
  const wait = tx.timestamp && lot.time ? `, ${duration(tx.timestamp - lot.time)} later` : ''
  const child = (o: RawTransaction['outputs'][number], why: string) => {
    const amount = o.amount * share
    const change = o.isChange ? ' (likely change, same owner)' : ''
    return {
      lot: { chain: 'btc' as const, address: o.address, asset: 'BTC', amount, time: tx.timestamp, via: tx.txid, vout: o.index, hop: lot.hop + 1 },
      flow: {
        from: lot.address, to: o.address, amount, asset: 'BTC', txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
        reason: `Exact: the coins were spent in ${tx.txid.slice(0, 10)}…${wait}; ${why}${share < 0.999 ? `; pooled: ${(share * 100).toFixed(1)}% of that tx's inputs were the traced funds, split pro rata` : ''}${change}`,
        ...(share < 0.999 ? { share } : {}),
      },
    }
  }

  if (adaptiveStopAt) {
    const plan = planBtcSpend(tx)
    const follow = new Set(plan.follow)
    // A peeled or minor output that lands at an exchange, mixer, etc. is still worth showing
    for (const i of plan.side) {
      const l = deps.labelOf(tx.outputs[i].address)
      if (l && adaptiveStopAt.includes(l.type)) follow.add(i)
    }
    for (const i of plan.side) {
      if (follow.has(i)) continue
      const o = tx.outputs[i]
      ends.push({
        address: o.address, amount: o.amount * share, asset: 'BTC', reason: plan.shape === 'peel' ? 'peel' : 'split',
        detail: `${plan.shape === 'peel' ? 'Peeled off' : 'Smaller output'} in ${tx.txid.slice(0, 10)}… from ${lot.address.slice(0, 10)}…; not followed (add it to follow this branch)`,
      })
    }
    return [...follow].map(i => child(tx.outputs[i], plan.note))
  }

  const back = tx.outputs.filter(o => o.address === lot.address).reduce((s, o) => s + o.amount * share, 0)
  if (back > 0) {
    ends.push({ address: lot.address, amount: back, asset: 'BTC', reason: 'unspent', detail: `${fmt(back, 'BTC')} paid back to the same address as change` })
  }
  return tx.outputs.filter(o => o.amount > 0 && o.address !== lot.address).map(o => child(o, 'every output followed'))
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

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDE', 'PYUSD'])
/** Smallest amount worth anything: dust and poisoning spam sit below it */
function dustFloor(asset: string) {
  return asset === 'ETH' || asset === 'WETH' ? 0.0005 : STABLES.has(asset) ? 1 : 0
}
/** Loaded transactions at which an unlabelled address is treated as a service hub */
const BUSY_HUB = 1000
/** Adaptive tracing follows outflows of at least this share of the traced amount */
const SIGNIFICANT = 0.05
/** Adaptive tracing only branches for moves of at least this share of the lot; smaller ones are noted */
const MAIN_SHARE = 0.15

/** Same amount within ~3% (or the gas tolerance), for spotting pass-throughs */
function sameAmount(a: number, b: number, asset: string) {
  return Math.abs(a - b) <= Math.max(a * 0.03, tolerance(a, asset))
}

async function ethForward(lot: Lot, deps: FollowDeps, ends: TraceEnd[], adaptive = true, minShare = 0) {
  const all = await deps.addressTxs(lot.address, lot.time)
  // A wallet with this much traffic is a service (router, payment processor, unlabelled
  // exchange), not one person's: following its outflows would trace strangers' money
  if (adaptive && lot.hop > 0 && all.length >= BUSY_HUB) {
    ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'entity', detail: `Busy address (${all.length.toLocaleString('en-US')}+ transactions): almost certainly a service or exchange wallet, so the trail stops here` })
    return []
  }
  // Dust and spam (poisoning 0.000000001 ETH, fake tokens) never count, in or out
  const real = all.filter(t => !t.asset.endsWith('*') && !(t.asset === lot.asset && (t.outputs[0]?.amount ?? 0) < dustFloor(lot.asset)))
  // Payments under 1% of the traced amount aren't followed
  const floor = lot.amount * 0.01
  const txs = real.filter(t => !(t.asset === lot.asset && (t.outputs[0]?.amount ?? 0) < floor))
  // Pooling: other funds of the same asset that arrived after the traced funds and
  // before a given outflow share that outflow (a balance already sitting there isn't
  // visible from loaded history, so this can only overstate the traced share). Many
  // small deposits still add up, so they count here even though they aren't followed.
  const otherIn = real.filter(t => t.asset === lot.asset && t.outputs[0]?.address === lot.address && t.inputs[0]?.address !== lot.address && t.txid !== lot.via && t.timestamp >= lot.time)
  const shareAt = (time: number) => {
    const other = otherIn.filter(t => t.timestamp <= time).reduce((s, t) => s + (t.outputs[0]?.amount ?? 0), 0)
    return lot.amount / (lot.amount + other)
  }
  const diluted = (time: number) => {
    const s = shareAt(time)
    if (s >= minShare) return false
    const other = lot.amount / s - lot.amount
    ends.push({
      address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'diluted', share: s,
      detail: `Pooled: ${fmt(other, lot.asset)} of other funds arrived before the money moved on, so the traced ${fmt(lot.amount, lot.asset)} was only ${pct(s)} of the pool (below the ${pct(minShare)} cut-off)`,
    })
    return true
  }
  // Only outflows after the funds arrived
  const outs = txs
    .filter(t => t.asset === lot.asset && t.inputs[0]?.address === lot.address && t.outputs[0]?.address !== lot.address)
    .filter(t => t.timestamp >= lot.time && t.txid !== lot.via && (t.outputs[0]?.amount ?? 0) > 0)
    .sort((a, b) => a.timestamp - b.timestamp)

  // Pass-through: the same amount leaving soon after it arrived is almost certainly the same money
  const pass = adaptive ? outs.find(t => sameAmount(lot.amount, t.outputs[0].amount, lot.asset)) : undefined

  // Swap: the traced asset leaves in a transaction that pays this wallet a different asset
  // back (Uniswap, 1inch, UniswapX, CoW…). The money is now that asset: keep following it here.
  const received = new Map<string, RawTransaction[]>()
  for (const t of txs) {
    if (t.outputs[0]?.address !== lot.address || t.inputs[0]?.address === lot.address) continue
    if (t.asset === lot.asset || t.asset.endsWith('*') || !((t.outputs[0]?.amount ?? 0) > 0)) continue
    received.set(t.txid, [...(received.get(t.txid) ?? []), t])
  }
  const swapOut = outs.find(t => received.has(t.txid))
  if (swapOut && (!pass || swapOut.timestamp <= pass.timestamp)) {
    if (diluted(swapOut.timestamp)) return []
    const got = received.get(swapOut.txid)!
    const asset = got[0].asset
    const gotTotal = got.filter(t => t.asset === asset).reduce((sum, t) => sum + t.outputs[0].amount, 0)
    const sold = Math.min(lot.amount, swapOut.outputs[0].amount)
    // Only the traced part of what was sold counts, so only that part of what came back
    const bought = gotTotal * (sold / swapOut.outputs[0].amount)
    const ps = shareAt(swapOut.timestamp)
    return [{
      lot: { chain: lot.chain, address: lot.address, asset, amount: bought, time: swapOut.timestamp, via: swapOut.txid, hop: lot.hop + 1 },
      flow: {
        from: lot.address, to: swapOut.outputs[0].address, amount: sold, asset: lot.asset, txid: swapOut.txid, time: swapOut.timestamp, hop: lot.hop + 1,
        reason: `Swapped ${fmt(sold, lot.asset)} for ${fmt(bought, asset)} in the same transaction; following the ${asset} from this wallet${ps < 0.999 ? `; pooled: traced funds ${pct(ps)} of the balance` : ''}`,
        swap: { asset, amount: bought },
        ...(ps < 0.999 ? { share: ps } : {}),
      },
    }]
  }

  if (pass) {
    if (diluted(pass.timestamp)) return []
    const ps = shareAt(pass.timestamp)
    return [{
      lot: { chain: lot.chain, address: pass.outputs[0].address, asset: lot.asset, amount: Math.min(lot.amount, pass.outputs[0].amount), time: pass.timestamp, via: pass.txid, hop: lot.hop + 1 },
      flow: {
        from: lot.address, to: pass.outputs[0].address, amount: Math.min(lot.amount, pass.outputs[0].amount), asset: lot.asset, txid: pass.txid, time: pass.timestamp, hop: lot.hop + 1,
        reason: `Pass-through: ${fmt(pass.outputs[0].amount, lot.asset)} left ${duration(pass.timestamp - lot.time)} after ${fmt(lot.amount, lot.asset)} arrived (same amount)${ps < 0.999 ? `; pooled: traced funds ${pct(ps)} of the balance` : ''}`,
        ...(ps < 0.999 ? { share: ps } : {}),
      },
    }]
  }

  // Adaptive: follow the moves that matter. Small payments leaving the wallet (each under 5% of
  // the traced amount) are summed into one side note instead of each becoming a branch.
  const significant = adaptive ? outs.filter(t => t.outputs[0].amount >= lot.amount * SIGNIFICANT) : outs
  if (adaptive && significant.length < outs.length) {
    const minor = outs.filter(t => t.outputs[0].amount < lot.amount * SIGNIFICANT)
    const total = minor.reduce((sum, t) => sum + t.outputs[0].amount, 0)
    ends.push({
      address: lot.address, amount: Math.min(total, lot.amount), asset: lot.asset, reason: 'split',
      detail: `${minor.length} small outflow${minor.length === 1 ? '' : 's'} (each under ${pct(SIGNIFICANT)} of the traced ${fmt(lot.amount, lot.asset)}) totalling ${fmt(total, lot.asset)}, not followed`,
    })
  }
  if (significant.length && diluted(significant[0].timestamp)) return []
  let remaining = lot.amount
  const tol = tolerance(lot.amount, lot.asset)
  const alloc = new Map<string, { amount: number; tx: RawTransaction; covered: number }>()
  for (const t of significant) {
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
    lot: { chain: lot.chain, address: tx.outputs[0].address, asset: lot.asset, amount, time: tx.timestamp, via: tx.txid, hop: lot.hop + 1 },
    flow: {
      from: lot.address, to: tx.outputs[0].address, amount, asset: lot.asset, txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
      reason: `Next ${lot.asset} outflow ${duration(tx.timestamp - lot.time)} after ${fmt(lot.amount, lot.asset)} arrived; ${fmt(amount, lot.asset)} of ${fmt(tx.outputs[0].amount, lot.asset)} attributed${shareAt(tx.timestamp) < 0.999 ? `; pooled: traced funds ${pct(shareAt(tx.timestamp))} of the balance` : ''}`,
      ...(shareAt(tx.timestamp) < 0.999 ? { share: shareAt(tx.timestamp) } : {}),
    },
  }))
}

async function ethBackward(lot: Lot, deps: FollowDeps, ends: TraceEnd[], adaptive = true) {
  // Look back up to a year before the funds left
  const all = await deps.addressTxs(lot.address, lot.time - 365 * 86400)
  if (adaptive && lot.hop > 0 && all.length >= BUSY_HUB) {
    ends.push({ address: lot.address, amount: lot.amount, asset: lot.asset, reason: 'entity', detail: `Busy address (${all.length.toLocaleString('en-US')}+ transactions): almost certainly a service or exchange wallet, so the trail stops here` })
    return []
  }
  // Dust, poisoning spam and fake tokens are never a source
  const floor = Math.max(dustFloor(lot.asset), lot.amount * 0.01)
  const txs = all.filter(t => !t.asset.endsWith('*') && !(t.asset === lot.asset && (t.outputs[0]?.amount ?? 0) < floor))
  const ins = txs
    .filter(t => t.asset === lot.asset && t.outputs[0]?.address === lot.address && t.inputs[0]?.address !== lot.address)
    .filter(t => t.timestamp <= lot.time && t.txid !== lot.via && (t.outputs[0]?.amount ?? 0) > 0)
    .sort((a, b) => b.timestamp - a.timestamp)

  // Same amount arriving shortly before it left: the likely source
  const src = adaptive ? ins.find(t => sameAmount(lot.amount, t.outputs[0].amount, lot.asset)) : undefined
  if (src) {
    const amount = Math.min(lot.amount, src.outputs[0].amount)
    return [{
      lot: { chain: lot.chain, address: src.inputs[0].address, asset: lot.asset, amount, time: src.timestamp, via: src.txid, hop: lot.hop + 1 },
      flow: {
        from: src.inputs[0].address, to: lot.address, amount, asset: lot.asset, txid: src.txid, time: src.timestamp, hop: lot.hop + 1,
        reason: `Pass-through: ${fmt(src.outputs[0].amount, lot.asset)} arrived ${duration(lot.time - src.timestamp)} before ${fmt(lot.amount, lot.asset)} left (same amount)`,
      },
    }]
  }

  // Adaptive: only inflows that could be a real part of the money; small top-ups are noted
  const sources = adaptive ? ins.filter(t => t.outputs[0].amount >= lot.amount * SIGNIFICANT) : ins
  if (adaptive && sources.length < ins.length) {
    const minor = ins.filter(t => t.outputs[0].amount < lot.amount * SIGNIFICANT)
    const total = minor.reduce((sum, t) => sum + t.outputs[0].amount, 0)
    ends.push({
      address: lot.address, amount: Math.min(total, lot.amount), asset: lot.asset, reason: 'split',
      detail: `${minor.length} small inflow${minor.length === 1 ? '' : 's'} (each under ${pct(SIGNIFICANT)} of the traced ${fmt(lot.amount, lot.asset)}) totalling ${fmt(total, lot.asset)}, not followed back`,
    })
  }
  let remaining = lot.amount
  const tol = tolerance(lot.amount, lot.asset)
  const picked: { amount: number; tx: RawTransaction }[] = []
  for (const t of sources) {
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
    lot: { chain: lot.chain, address: tx.inputs[0].address, asset: lot.asset, amount, time: tx.timestamp, via: tx.txid, hop: lot.hop + 1 },
    flow: {
      from: tx.inputs[0].address, to: lot.address, amount, asset: lot.asset, txid: tx.txid, time: tx.timestamp, hop: lot.hop + 1,
      reason: `Most recent ${lot.asset} inflow ${duration(lot.time - tx.timestamp)} before the funds left; ${fmt(amount, lot.asset)} attributed`,
    },
  }))
}

// ── Seeds ──────────────────────────────────────────────────────────────────

/** Lots created by one transaction leaving `from` (optionally only to `to`) */
export function seedsFromTx(tx: RawTransaction, from: string, to?: string, adaptive = true): { lots: Lot[]; flows: TracedFlow[]; ends: TraceEnd[] } {
  const lots: Lot[] = []
  const flows: TracedFlow[] = []
  const ends: TraceEnd[] = []
  // Tracing the whole transaction: apply the same shape rules as later hops
  const plan = adaptive && !to && tx.chain === 'btc' ? planBtcSpend(tx) : null
  // A "peel" whose remainder is the sender's own change is an ordinary payment: the small
  // output is the payment itself, so it is followed rather than set aside
  const payment = plan?.shape === 'peel' && plan.follow.every(i => tx.outputs[i].address === from || tx.outputs[i].isChange)
  const skip = new Set(payment ? [] : plan?.side.map(i => tx.outputs[i].address) ?? [])
  const totalIn = tx.inputs.reduce((s, i) => s + i.amount, 0)
  const mine = tx.inputs.filter(i => i.address === from).reduce((s, i) => s + i.amount, 0)
  const share = tx.chain === 'btc' && totalIn > 0 && mine > 0 ? mine / totalIn : 1
  for (const o of tx.outputs) {
    // Change outputs are followed too: the funds still left this address, and the
    // change guess can be wrong (it's a heuristic)
    if (o.address === from || o.amount <= 0 || (to && o.address !== to)) continue
    if (skip.has(o.address)) {
      ends.push({ address: o.address, amount: o.amount * share, asset: tx.asset, reason: plan!.shape === 'peel' ? 'peel' : 'split', detail: `${plan!.shape === 'peel' ? 'Peeled off' : 'Smaller output'} in the starting transaction; not followed` })
      continue
    }
    const amount = o.amount * share
    lots.push({ chain: tx.chain, address: o.address, asset: tx.asset, amount, time: tx.timestamp, via: tx.txid, vout: o.index, hop: 1 })
    flows.push({ from, to: o.address, amount, asset: tx.asset, txid: tx.txid, time: tx.timestamp, hop: 1, reason: `Starting transaction${payment ? ' (payment; the rest was the sender\'s change)' : plan ? ` (${plan.note})` : ''}${o.isChange ? ' (likely change, same owner)' : ''}` })
  }
  return { lots, flows, ends }
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
    lots: [{ chain: tx.chain, address: sender, asset: tx.asset, amount: received, time: tx.timestamp, via: tx.txid, hop: 1 }],
    flows: [{ from: sender, to, amount: received, asset: tx.asset, txid: tx.txid, time: tx.timestamp, hop: 1, reason: 'Starting transaction' }],
  }
}
