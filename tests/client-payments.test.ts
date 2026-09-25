import { describe, expect, it } from 'vitest'
import { parseClientPayments, judgePayment, parseDate, seedsFromPayments, PaymentMatch } from '@/lib/client-payments'

const TX = 'ebc6db475404ba5aa8c79e509d7495bfbcb919c2f2d86874b36d725bb8342ee4'
const ETHTX = '0x' + 'ab'.repeat(32)
const SCAM = '0x' + 'b2'.padEnd(40, '0')

describe('parseDate', () => {
  it('reads NZ day-first and written dates', () => {
    const d = Date.UTC(2026, 2, 9, 12) / 1000
    for (const s of ['2026-03-09', '09/03/2026', '9/3/26', '9 Mar 2026', 'March 9 2026', '9 March 2026']) expect(parseDate(s)).toBe(d)
  })
})

describe('parseClientPayments', () => {
  it('reads tx, amount, asset and date in any order and separator', () => {
    const [a, b, c] = parseClientPayments(`${TX}, 2 BTC, 01/07/2017\n5000 USDT\t${SCAM}\t9 Mar 2026\n${ETHTX} 1.5ETH 2026-03-09`)
    expect(a).toMatchObject({ txid: TX, amount: 2, asset: 'BTC', date: Date.UTC(2017, 6, 1, 12) / 1000, errors: [] })
    expect(b).toMatchObject({ address: SCAM, chain: 'eth', amount: 5000, asset: 'USDT', errors: [] })
    expect(c).toMatchObject({ txid: ETHTX, chain: 'eth', amount: 1.5, asset: 'ETH' })
  })
  it('explains what is missing', () => {
    expect(parseClientPayments('2 BTC 2026-03-09')[0].errors[0]).toMatch(/hash or a wallet address/)
    expect(parseClientPayments(SCAM)[0].errors).toEqual([]) // an address alone is fine: its payments are listed
  })
})

describe('judgePayment', () => {
  const day = (d: string) => Date.parse(`${d}T09:00:00Z`) / 1000
  const m = (amount: number, date: string, to = SCAM, asset = 'USDT'): PaymentMatch =>
    ({ chain: 'eth', txid: `t${amount}${date}`, from: '0xclient', to, amount, asset, timestamp: day(date) })

  it('verifies when amount and date match', () => {
    const [claim] = parseClientPayments(`${SCAM} 5000 USDT 9/3/2026`)
    expect(judgePayment(claim, [m(1, '2026-03-01'), m(5000, '2026-03-09')], 'p1')).toMatchObject({ status: 'verified', match: { amount: 5000 } })
  })
  it('flags a mismatch with the difference spelled out', () => {
    const [claim] = parseClientPayments(`${ETHTX} 5 ETH 2026-03-03`)
    const r = judgePayment(claim, [{ ...m(4.8, '2026-03-04'), asset: 'ETH' }], 'p1')
    expect(r.status).toBe('mismatch')
    expect(r.notes.join(' ')).toMatch(/said 5 ETH, on-chain 4.8 ETH/)
  })
  it('reports ambiguity and not-found for address-only claims', () => {
    const [claim] = parseClientPayments(`${SCAM} 1000 USDT 2026-03-09`)
    expect(judgePayment(claim, [m(1000, '2026-03-09'), m(1000, '2026-03-10')], 'p').status).toBe('ambiguous')
    expect(judgePayment(claim, [m(1000, '2026-05-01')], 'p').status).toBe('not-found')
  })
  it('lists every payment for a bare address and lets the investigator pick several', async () => {
    const { choosePayment } = await import('@/lib/client-payments')
    const [claim] = parseClientPayments(SCAM)
    const found = [m(1, '2026-03-01'), m(2, '2026-03-02'), { ...m(3, '2026-03-03'), asset: 'USDT*' }]
    const r = judgePayment(claim, found, 'p')
    expect(r.status).toBe('ambiguous')
    expect(r.candidates!.map(c => c.amount)).toEqual([2, 1]) // newest first, fake token dropped
    let list = choosePayment([r], 'p', r.candidates![0], 'q')
    list = choosePayment(list, 'p', r.candidates![1], 'q2')
    expect(list.map(x => [x.status, x.match?.amount])).toEqual([['chosen', 2], ['chosen', 1]])
    expect(seedsFromPayments(list).lots).toHaveLength(2)
  })

  it('seeds a trace from the recipient of each found payment', () => {
    const [claim] = parseClientPayments(`${SCAM} 5000 USDT 9/3/2026`)
    const { lots, flows } = seedsFromPayments([judgePayment(claim, [m(5000, '2026-03-09')], 'p1')])
    expect(lots[0]).toMatchObject({ address: SCAM, amount: 5000, asset: 'USDT' })
    expect(flows[0].reason).toMatch(/Client payment 1 \(verified/)
  })
})
