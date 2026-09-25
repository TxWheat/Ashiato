import { Chain, RawTransaction } from './types'
import { detectChain, normaliseAddress } from './detect-chain'
import type { Lot, TracedFlow } from './follow'

// Client payment intake: the client tells us "I sent X on date D to address A
// (tx T)". We parse that, find it on-chain and say whether it checks out.

export interface ClaimedPayment {
  /** Row as typed */
  line: string
  txid?: string
  /** Chain implied by the txid or address, when unambiguous */
  chain?: Chain
  address?: string
  amount?: number
  asset?: string
  /** Unix seconds, midday UTC of the stated day */
  date?: number
  errors: string[]
}

export type PaymentStatus = 'verified' | 'mismatch' | 'ambiguous' | 'chosen' | 'not-found' | 'error'

export interface PaymentMatch {
  chain: Chain
  txid: string
  from: string
  to: string
  amount: number
  asset: string
  timestamp: number
  /** Output index (BTC) for exact coin following */
  vout?: number
}

export interface CheckedPayment {
  id: string
  claim: ClaimedPayment
  status: PaymentStatus
  match?: PaymentMatch
  /** Other close candidates when ambiguous */
  candidates?: PaymentMatch[]
  notes: string[]
}

const ASSETS = /^(BTC|ETH|USDT|USDC|DAI|WETH|WBTC|TRX)$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const midday = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  return Date.UTC(y, m - 1, d, 12) / 1000
}

/** 2026-03-09, 09/03/2026 (NZ day-first), 9/3/26, 9 Mar 2026, Mar 9 2026 */
export function parseDate(s: string): number | undefined {
  const t = s.trim().replace(/,/g, ' ').replace(/\s+/g, ' ')
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/)
  if (m) return midday(+m[1], +m[2], +m[3])
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) return midday(+m[3], +m[2], +m[1])
  m = t.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{2,4})$/i)
  if (m && MONTHS.includes(m[2].toLowerCase())) return midday(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
  m = t.match(/^([a-z]{3})[a-z]* (\d{1,2}) (\d{2,4})$/i)
  if (m && MONTHS.includes(m[1].toLowerCase())) return midday(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  return undefined
}

/**
 * One payment per line, fields in any order, separated by commas, tabs or spaces:
 *   <tx hash> <amount> <asset> <date>
 *   <recipient address> 0.5 BTC 2026-03-09
 * Dates can contain spaces ("9 Mar 2026").
 */
export function parseClientPayments(text: string): ClaimedPayment[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(line => {
    const claim: ClaimedPayment = { line, errors: [] }
    let rest = line.replace(/[,;\t|]+/g, ' ').replace(/\s+/g, ' ')
    // Dates with words first, so their numbers aren't read as amounts
    const wordDate = rest.match(/\b\d{1,2} [a-z]{3,9} \d{2,4}\b|\b[a-z]{3,9} \d{1,2} \d{2,4}\b/i)
    if (wordDate) {
      const d = parseDate(wordDate[0])
      if (d) {
        claim.date = d
        rest = rest.replace(wordDate[0], ' ')
      }
    }
    for (const tok of rest.split(' ').filter(Boolean)) {
      const clean = tok.replace(/^\$/, '')
      if (/^0x[0-9a-fA-F]{64}$/.test(clean)) {
        claim.txid = clean.toLowerCase()
        claim.chain = 'eth'
      } else if (/^[0-9a-fA-F]{64}$/.test(clean)) {
        claim.txid = clean.toLowerCase() // BTC (or Tron): resolved when checking
      } else if (detectChain(clean)) {
        const chain = detectChain(clean)!
        claim.address = normaliseAddress(clean, chain)
        claim.chain = claim.chain ?? chain
      } else if (!claim.date && parseDate(clean)) {
        claim.date = parseDate(clean)
      } else if (ASSETS.test(clean)) {
        claim.asset = clean.toUpperCase()
      } else if (/^\d+(\.\d+)?$/.test(clean) && claim.amount === undefined) {
        claim.amount = parseFloat(clean)
      } else if (/^\d+(\.\d+)?[a-z]{3,4}$/i.test(clean) && ASSETS.test(clean.replace(/^[\d.]+/, ''))) {
        claim.amount = parseFloat(clean)
        claim.asset = clean.replace(/^[\d.]+/, '').toUpperCase()
      } else {
        claim.errors.push(`Didn't understand “${tok}”`)
      }
    }
    if (!claim.txid && !claim.address) claim.errors.push('Needs a transaction hash or a wallet address')
    return claim
  })
}

const DAY = 86400

function amountClose(claimed: number, actual: number, asset: string, pct: number) {
  // BTC/ETH network fees or wallet rounding: allow a small absolute slack too
  const slack = asset === 'BTC' ? 0.0005 : asset === 'ETH' ? 0.002 : 0.01
  return Math.abs(claimed - actual) <= Math.max(claimed * pct, slack)
}

/** Every value transfer in a set of transactions, as payment candidates */
export function transfersOf(txs: RawTransaction[]): PaymentMatch[] {
  const out: PaymentMatch[] = []
  for (const t of txs) {
    const from = t.inputs[0]?.address ?? ''
    for (const o of t.outputs) {
      if (!o.address || o.amount <= 0) continue
      if (t.chain === 'btc' && t.inputs.some(i => i.address === o.address)) continue // change back to the sender
      out.push({ chain: t.chain, txid: t.txid, from, to: o.address, amount: o.amount, asset: t.asset, timestamp: t.timestamp, vout: o.index })
    }
  }
  return out
}

/**
 * Compares a claim with the transfers found for it (from its tx, or the address's
 * history). Verified = amount within 2% and date within a day of what was stated.
 */
export function judgePayment(claim: ClaimedPayment, found: PaymentMatch[], id: string): CheckedPayment {
  const notes: string[] = []
  let pool = found
  if (claim.address) pool = pool.filter(m => m.to === claim.address || m.from === claim.address)
  if (claim.asset) pool = pool.filter(m => m.asset.replace(/\*$/, '') === claim.asset)
  if (!pool.length) {
    return { id, claim, status: 'not-found', notes: [claim.txid ? 'The transaction exists, but no transfer in it matches the stated address/asset' : 'No matching payment in the loaded history of this address'] }
  }

  // Only an address: every payment in or out of it is a candidate for the user to pick
  if (!claim.txid && claim.address && claim.amount === undefined && claim.date === undefined) {
    // Fake-token spam (poisoning) is never a client payment
    const all = pool.filter(m => !m.asset.endsWith('*')).sort((x, y) => y.timestamp - x.timestamp)
    return {
      id, claim, status: 'ambiguous', candidates: all.slice(0, 500),
      notes: [`${all.length} payment${all.length === 1 ? '' : 's'} in or out of this address${all.length > 500 ? ' (latest 500)' : ''}. Pick the client's with Use, or add the amount and date to find it automatically.`],
    }
  }

  const score = (m: PaymentMatch) => {
    const a = claim.amount !== undefined ? Math.abs(m.amount - claim.amount) / Math.max(claim.amount, 1e-9) : 0
    const d = claim.date !== undefined && m.timestamp ? Math.abs(m.timestamp - claim.date) / DAY : 0
    return a * 10 + d
  }
  const ranked = [...pool].sort((x, y) => score(x) - score(y))
  const close = ranked.filter(m =>
    (claim.amount === undefined || amountClose(claim.amount, m.amount, m.asset, 0.05)) &&
    (claim.date === undefined || !m.timestamp || Math.abs(m.timestamp - claim.date) <= 3 * DAY))

  // Found by address only: nothing near the stated amount/date means not found
  if (!claim.txid && !close.length) {
    return { id, claim, status: 'not-found', notes: ['No payment of about that amount within 3 days of that date'] }
  }
  const best = (close[0] ?? ranked[0])
  const amountOk = claim.amount === undefined || amountClose(claim.amount, best.amount, best.asset, 0.02)
  const dateOk = claim.date === undefined || !best.timestamp || Math.abs(best.timestamp - claim.date) <= 1.5 * DAY
  if (claim.amount !== undefined && !amountOk) notes.push(`Client said ${claim.amount} ${best.asset}, on-chain ${+best.amount.toPrecision(8)} ${best.asset}`)
  if (claim.date !== undefined && best.timestamp && !dateOk) {
    notes.push(`Client said ${new Date(claim.date * 1000).toISOString().slice(0, 10)}, on-chain ${new Date(best.timestamp * 1000).toISOString().slice(0, 10)}`)
  }
  if (!best.timestamp) notes.push('Still unconfirmed (pending)')
  const exact = close.filter(m => amountClose(claim.amount ?? m.amount, m.amount, m.asset, 0.02))
  if (!claim.txid && exact.length > 1) {
    return { id, claim, status: 'ambiguous', candidates: exact.slice(0, 20), notes: [`${exact.length} payments of about that amount near that date. Pick the client's with Use.`] }
  }
  return { id, claim, status: amountOk && dateOk ? 'verified' : 'mismatch', match: best, notes }
}

/** Trace seeds for checked payments: the funds sitting at each recipient */
export function seedsFromPayments(payments: CheckedPayment[]): { lots: Lot[]; flows: TracedFlow[] } {
  const lots: Lot[] = []
  const flows: TracedFlow[] = []
  payments.forEach((p, i) => {
    const m = p.match
    if (!m || (p.status !== 'verified' && p.status !== 'mismatch' && p.status !== 'chosen')) return
    lots.push({ chain: m.chain, address: m.to, asset: m.asset, amount: m.amount, time: m.timestamp, via: m.txid, vout: m.vout, hop: 1 })
    flows.push({
      from: m.from, to: m.to, amount: m.amount, asset: m.asset, txid: m.txid, time: m.timestamp, hop: 1,
      reason: `Client payment ${i + 1}${p.status === 'verified' ? ' (verified on-chain)' : p.status === 'chosen' ? ' (picked by the investigator)' : ' (on-chain, details differ from the client’s)'}`,
    })
  })
  return { lots, flows }
}

/**
 * The investigator picks a candidate: the first pick turns the row into that payment,
 * further picks add rows (a client who paid several times).
 */
export function choosePayment(list: CheckedPayment[], rowId: string, m: PaymentMatch, newId: string): CheckedPayment[] {
  const row = list.find(x => x.id === rowId)
  if (!row) return list
  const note = 'Picked from the address’s payments'
  if (row.status === 'ambiguous') return list.map(x => (x.id === rowId ? { ...x, status: 'chosen', match: m, notes: [note] } : x))
  const i = list.indexOf(row)
  return [...list.slice(0, i + 1), { id: newId, claim: row.claim, status: 'chosen', match: m, candidates: row.candidates, notes: [note] }, ...list.slice(i + 1)]
}
