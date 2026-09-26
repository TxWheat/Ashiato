import { decodeEventLog, erc20Abi, formatUnits } from 'viem'

// Ashiato Pro, paid in USDC for a set number of months. Each payment adds its months
// on top of any time left, so renewing early loses nothing.

export const PRO_PLANS = [
  { months: 1, usdc: 9 },
  { months: 3, usdc: 25 },
  { months: 12, usdc: 90 },
] as const

export const PAY_CHAINS = {
  base: { id: 8453, name: 'Base', usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', tx: 'https://basescan.org/tx/' },
  eth: { id: 1, name: 'Ethereum', usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tx: 'https://etherscan.io/tx/' },
} as const
export type PayChain = keyof typeof PAY_CHAINS

export const USDC_DECIMALS = 6
/** Days before expiry to start reminding */
export const REMIND_DAYS = 7

/** Months a payment buys: the longest plan it covers (0 = too little) */
export function monthsFor(usdc: number): number {
  return PRO_PLANS.filter(p => usdc + 1e-9 >= p.usdc).reduce((m, p) => Math.max(m, p.months), 0)
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

/** When Pro ends, from every payment: each starts when it was paid or when the time before it runs out */
export function proExpiry(payments: { months: number; paidAt: string }[]): Date | null {
  let end: Date | null = null
  for (const p of [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
    const paid = new Date(p.paidAt)
    end = addMonths(end && end > paid ? end : paid, p.months)
  }
  return end
}

interface Log { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }

/** USDC sent from `from` to `to` in a transaction's logs, in whole USDC */
export function usdcPaid(logs: Log[], usdc: string, from: string, to: string): number {
  let raw = 0n
  for (const log of logs) {
    if (log.address.toLowerCase() !== usdc.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] })
      if (ev.eventName === 'Transfer' && ev.args.from.toLowerCase() === from.toLowerCase() && ev.args.to.toLowerCase() === to.toLowerCase()) raw += ev.args.value
    } catch { /* another event */ }
  }
  return Number(formatUnits(raw, USDC_DECIMALS))
}
