import { Finding, RawTransaction } from '../../types'

// Change-output detection. Each rule adds evidence to one output; the output
// with the most evidence wins if it is clearly ahead. Rules follow the
// literature (Meiklejohn et al. 2013, BlockSci, peterzen/heuristic).

const SATS = 1e8

function sats(btc: number) {
  return Math.round(btc * SATS)
}

/** Payments are usually round in BTC; change almost never is */
function roundness(v: number): number {
  if (v % 1_000_000 === 0) return 2 // 0.01 BTC multiple
  if (v % 10_000 === 0) return 1 // 0.0001 BTC multiple
  return 0
}

/**
 * Returns the index (into tx.outputs) of the likely change output and why,
 * or undefined when no output stands out.
 */
export function detectChange(tx: RawTransaction): { index: number; finding: Finding } | undefined {
  if (tx.chain !== 'btc' || tx.isCoinbase || tx.coinjoin) return undefined
  const outs = tx.outputs
    .map((o, i) => ({ ...o, i, v: sats(o.amount) }))
    .filter(o => o.address && o.v > 0)
  if (outs.length < 2) return undefined

  const inputAddrs = new Set(tx.inputs.map(i => i.address))

  // 1. Address reuse: paying back to one of the input addresses is certainly change
  const reused = outs.filter(o => inputAddrs.has(o.address))
  if (reused.length === 1 && reused.length < outs.length) {
    return {
      index: reused[0].i,
      finding: { heuristic: 'change', confidence: 0.95, reasons: ['Output pays back to an input address (address reuse)'] },
    }
  }
  if (reused.length > 0) return undefined // self-send / sweep; nothing to infer

  const score = new Map<number, { s: number; reasons: string[] }>()
  const bump = (i: number, s: number, reason: string) => {
    const e = score.get(i) ?? { s: 0, reasons: [] }
    e.s += s
    e.reasons.push(reason)
    score.set(i, e)
  }

  // 2. Peel chain: one or two input addresses, two outputs, one many times larger.
  //    A small payment is peeled off and the remainder moves on to a fresh address
  //    (the classic laundering / exchange-withdrawal pattern), so the large one is change.
  const [big, small] = [...outs].sort((a, b) => b.v - a.v)
  const peel = outs.length === 2 && new Set(tx.inputs.map(i => i.address)).size <= 2 && big.v >= 3 * small.v
  if (peel) bump(big.i, 0.5, 'Keeps most of the value while a small payment is peeled off (peel chain)')

  // 3. Round amounts: if every output but one is round, the odd one is change.
  //    Weak inside a peel chain, where payments are often exact odd amounts and the
  //    remainder can land on round numbers (15 → 14 → 13 BTC).
  const r = outs.map(o => roundness(o.v))
  const nonRound = outs.filter((_, k) => r[k] === 0)
  if (nonRound.length === 1 && outs.some((_, k) => r[k] > 0)) {
    const strong = outs.some((_, k) => r[k] === 2)
    bump(nonRound[0].i, peel ? 0.15 : strong ? 0.45 : 0.3, 'Only non-round output (payments tend to be round amounts)')
  }

  // 4. Script type: change uses the same script type as all the inputs
  const inTypes = new Set(tx.inputs.map(i => i.scriptType).filter(Boolean))
  if (inTypes.size === 1) {
    const t = [...inTypes][0]
    const same = outs.filter(o => o.scriptType === t)
    if (same.length === 1) bump(same[0].i, 0.3, `Only output with the same script type as the inputs (${t})`)
  }

  // 5. Optimal change: change is smaller than every input, otherwise the wallet
  //    would not have needed that input
  if (tx.inputs.length >= 2) {
    const minIn = Math.min(...tx.inputs.map(i => sats(i.amount)))
    const smaller = outs.filter(o => o.v < minIn)
    if (smaller.length === 1) bump(smaller[0].i, 0.3, 'Only output smaller than every input (unnecessary-input rule)')
  }

  const ranked = [...score.entries()].sort((a, b) => b[1].s - a[1].s)
  if (ranked.length === 0) return undefined
  const [bestIdx, best] = ranked[0]
  const runnerUp = ranked[1]?.[1].s ?? 0
  if (best.s < 0.3 || best.s - runnerUp < 0.15) return undefined
  return {
    index: bestIdx,
    finding: { heuristic: 'change', confidence: Math.min(0.9, 0.35 + best.s * 0.6), reasons: best.reasons },
  }
}

/** Marks change outputs on the tx in place and returns it */
export function annotateChange(tx: RawTransaction): RawTransaction {
  const hit = detectChange(tx)
  if (hit) {
    tx.outputs[hit.index].isChange = true
    tx.outputs[hit.index].change = hit.finding
  }
  return tx
}
