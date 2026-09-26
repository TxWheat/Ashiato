import { Chain, EntityLabel, RawTransaction } from '../types'
import { MAJOR_ASSETS } from '../format'

// Turns a watched address's transactions into alerts: each new transfer in or out, the
// amount, who was on the other side, and whether it reached an exchange.

export interface AlertEvent {
  txid: string
  time: number
  direction: 'in' | 'out'
  amount: number
  asset: string
  counterparty: string
  counterpartyLabel?: string
  /** The money reached (or came from) an exchange: the window to ask for a freeze */
  urgent: boolean
}

const URGENT: EntityLabel['type'][] = ['exchange', 'deposit']
/** Below this, a transfer is dust or address-poisoning spam (the trace engine's floor) */
const dust = (asset: string) => (asset === 'ETH' || asset === 'WETH' ? 0.0005 : /^(USDT|USDC|DAI)$/.test(asset) ? 1 : 0)
const same = (a: string, b: string, chain: Chain) => (chain === 'eth' ? a.toLowerCase() === b.toLowerCase() : a === b)

export function alertEvents(
  address: string,
  chain: Chain,
  txs: RawTransaction[],
  after: number,
  labelOf: (a: string) => EntityLabel | undefined,
): AlertEvent[] {
  const events = new Map<string, AlertEvent>()
  for (const tx of txs) {
    // Spam tokens (marked *) and poisoning dust never alert
    if (tx.timestamp <= after || tx.asset.endsWith('*') || tx.failed) continue
    const sent = tx.inputs.some(i => same(i.address, address, chain))
    const toUs = tx.outputs.filter(o => same(o.address, address, chain))
    let direction: AlertEvent['direction']
    let amount: number
    let counterparty: string
    if (sent) {
      const away = tx.outputs.filter(o => o.address && !same(o.address, address, chain))
      if (!away.length) continue
      direction = 'out'
      amount = away.reduce((s, o) => s + o.amount, 0)
      counterparty = away.reduce((a, b) => (b.amount > a.amount ? b : a)).address
    } else if (toUs.length) {
      direction = 'in'
      amount = toUs.reduce((s, o) => s + o.amount, 0)
      counterparty = tx.inputs[0]?.address ?? ''
    } else continue
    if (!(amount > dust(tx.asset))) continue
    // Unknown tokens arriving are airdrop spam; unknown tokens leaving still matter
    if (direction === 'in' && !MAJOR_ASSETS.has(tx.asset)) continue
    const label = counterparty ? labelOf(counterparty) : undefined
    const key = `${tx.txid}:${direction}:${tx.asset}`
    const prev = events.get(key)
    // One transaction can carry several transfers of the same asset: add them up
    events.set(key, prev ? { ...prev, amount: prev.amount + amount } : {
      txid: tx.txid, time: tx.timestamp, direction, amount, asset: tx.asset, counterparty,
      counterpartyLabel: label?.name, urgent: !!label && URGENT.includes(label.type),
    })
  }
  return [...events.values()].sort((a, b) => b.time - a.time)
}
