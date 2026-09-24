import { CoinJoinFinding, RawTransaction } from '../../types'

// CoinJoin fingerprints. Ideas from peterzen/heuristic (MIT) and the public
// Whirlpool / Wasabi / JoinMarket protocol specs.

const WHIRLPOOL_POOLS = [0.001, 0.01, 0.05, 0.5] // BTC
const SATS = 1e8

function toSats(btc: number) {
  return Math.round(btc * SATS)
}

/** Largest group of outputs sharing exactly the same value */
function equalOutputGroups(tx: RawTransaction) {
  const counts = new Map<number, number>()
  for (const o of tx.outputs) {
    const v = toSats(o.amount)
    if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let bestValue = 0
  let bestCount = 0
  let groups = 0
  for (const [v, c] of counts) {
    if (c >= 2) groups++
    if (c > bestCount || (c === bestCount && v > bestValue)) {
      bestCount = c
      bestValue = v
    }
  }
  return { bestValue, bestCount, groups }
}

export function detectCoinJoin(tx: RawTransaction): CoinJoinFinding | undefined {
  if (tx.chain !== 'btc' || tx.isCoinbase) return undefined
  const nIn = tx.inputs.length
  const nOut = tx.outputs.length
  if (nIn < 2 || nOut < 3) return undefined

  const inputAddrs = new Set(tx.inputs.map(i => i.address))
  const { bestValue, bestCount, groups } = equalOutputGroups(tx)

  // Whirlpool: exactly 5 inputs and 5 outputs of one pool denomination
  // (the pool fee is paid in a separate Tx0, so outputs are exactly equal)
  if (nIn === 5 && nOut === 5 && bestCount === 5 && WHIRLPOOL_POOLS.some(p => toSats(p) === bestValue)) {
    return {
      heuristic: 'coinjoin',
      kind: 'whirlpool',
      confidence: 0.95,
      reasons: [`5 inputs → 5 equal outputs of ${bestValue / SATS} BTC (Whirlpool pool size)`],
    }
  }

  // Wasabi 2 (WabiSabi): very large rounds with many standard denominations
  if (nIn >= 50 && nOut >= 50 && groups >= 5) {
    return {
      heuristic: 'coinjoin',
      kind: 'wasabi2',
      confidence: 0.85,
      reasons: [`${nIn} inputs, ${nOut} outputs, ${groups} groups of equal-value outputs (WabiSabi-style round)`],
    }
  }

  // Wasabi 1: ≥10 equal outputs of about 0.1 BTC plus coordinator fee and change
  const btc = bestValue / SATS
  if (bestCount >= 10 && btc >= 0.09 && btc <= 0.11 && inputAddrs.size >= bestCount) {
    return {
      heuristic: 'coinjoin',
      kind: 'wasabi1',
      confidence: 0.9,
      reasons: [`${bestCount} equal outputs of ${btc} BTC (≈0.1 BTC Wasabi 1 denomination)`],
    }
  }

  // JoinMarket: n equal outputs + up to n change outputs (+1 for the taker), ≥n inputs
  if (bestCount >= 3 && inputAddrs.size >= bestCount && nOut <= 2 * bestCount + 1 && nOut >= bestCount) {
    return {
      heuristic: 'coinjoin',
      kind: bestCount >= 5 ? 'joinmarket' : 'generic',
      confidence: bestCount >= 5 ? 0.75 : 0.55,
      reasons: [
        `${bestCount} equal outputs of ${btc} BTC from ${inputAddrs.size} distinct input addresses`,
        `${nOut - bestCount} other output(s), consistent with per-participant change`,
      ],
    }
  }

  return undefined
}
