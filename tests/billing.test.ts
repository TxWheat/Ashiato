import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbiParameters } from 'viem'
import { addMonths, monthsFor, PAY_CHAINS, proExpiry, usdcPaid } from '@/lib/billing/plans'

const ME = '0xaaaa000000000000000000000000000000000001'
const US = '0xbbbb000000000000000000000000000000000002'
const transfer = (from: string, to: string, usdc: number, token: string = PAY_CHAINS.base.usdc) => ({
  address: token,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: from as `0x${string}`, to: to as `0x${string}` } }) as `0x${string}`[],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(Math.round(usdc * 1e6))]),
})

describe('plans', () => {
  it('buys the longest plan a payment covers', () => {
    expect(monthsFor(8.99)).toBe(0)
    expect(monthsFor(9)).toBe(1)
    expect(monthsFor(25)).toBe(3)
    expect(monthsFor(40)).toBe(3)
    expect(monthsFor(90)).toBe(12)
  })

  it('stacks payments: renewing early adds on top, a lapse starts fresh', () => {
    expect(proExpiry([])).toBeNull()
    const early = proExpiry([{ months: 1, paidAt: '2026-01-10T00:00:00Z' }, { months: 3, paidAt: '2026-02-01T00:00:00Z' }])
    expect(early?.toISOString()).toBe('2026-05-10T00:00:00.000Z')
    const lapsed = proExpiry([{ months: 1, paidAt: '2026-01-10T00:00:00Z' }, { months: 1, paidAt: '2026-06-01T00:00:00Z' }])
    expect(lapsed?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(addMonths(new Date('2026-11-15T00:00:00Z'), 12).toISOString()).toBe('2027-11-15T00:00:00.000Z')
  })
})

describe('USDC payments', () => {
  it('counts only USDC from the payer to Ashiato', () => {
    const logs = [
      transfer(ME, US, 9),
      transfer(ME, US, 16),
      transfer(US, ME, 5), // wrong way
      transfer('0xcccc000000000000000000000000000000000003', US, 90), // someone else
      transfer(ME, US, 90, '0x0000000000000000000000000000000000000bad'), // not USDC
    ]
    expect(usdcPaid(logs, PAY_CHAINS.base.usdc, ME, US)).toBe(25)
    expect(usdcPaid(logs, PAY_CHAINS.base.usdc.toUpperCase().replace('0X', '0x'), ME.toUpperCase().replace('0X', '0x'), US)).toBe(25)
    expect(usdcPaid([], PAY_CHAINS.base.usdc, ME, US)).toBe(0)
  })
})

describe('wallet network ids', () => {
  it('reads numbers, hex and CAIP-2 text (Reown email wallets)', async () => {
    const { parseChainId } = await import('@/lib/wallet')
    expect(parseChainId('eip155:1')).toBe(1)
    expect(parseChainId('eip155:8453')).toBe(8453)
    expect(parseChainId('0x2105')).toBe(8453)
    expect(parseChainId(8453)).toBe(8453)
    expect(parseChainId(1n)).toBe(1)
    expect(parseChainId('nonsense')).toBeUndefined()
  })
})
