import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { base58ToHex, fetchTronTx, hexToBase58, traceTronAddress } from '@/lib/chains/tron'
import { detectChain, detectInput } from '@/lib/detect-chain'

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'

describe('Tron addresses', () => {
  it('converts between hex and base58check (real USDT contract)', () => {
    expect(hexToBase58(USDT_HEX)).toBe(USDT)
    expect(base58ToHex(USDT)).toBe(USDT_HEX)
    expect(base58ToHex(USDT.slice(0, -1) + (USDT.endsWith('t') ? 'u' : 't'))).toBeNull() // bad checksum
  })
  it('is detected as Tron', () => {
    expect(detectChain(USDT)).toBe('tron')
    expect(detectInput(USDT)).toMatchObject({ kind: 'address', chain: 'tron', value: USDT })
  })
})

const calls: string[] = []
function mockFetch(route: (url: string, body?: string) => unknown) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url)
    return new Response(JSON.stringify(route(url, init?.body as string | undefined)), { status: 200 })
  })
}
beforeEach(() => { calls.length = 0 })
afterEach(() => vi.unstubAllGlobals())

// Made-up but valid addresses
const ME = hexToBase58('41' + '11'.repeat(20))
const SCAM = hexToBase58('41' + '22'.repeat(20))
const FAKE_USDT = hexToBase58('41' + '33'.repeat(20))
const ts = 1_720_000_000_000

describe('traceTronAddress', () => {
  it('reads TRX and TRC-20 transfers, flags fake USDT, and pages with both fingerprints', async () => {
    mockFetch(url => {
      if (url.includes('/transactions/trc20')) return {
        success: true, meta: { fingerprint: 'fpTRC' },
        data: [
          { transaction_id: 'a'.repeat(64), block_timestamp: ts, from: SCAM, to: ME, value: '5000000000', type: 'Transfer', token_info: { symbol: 'USDT', address: USDT, decimals: 6 } },
          { transaction_id: 'b'.repeat(64), block_timestamp: ts + 1000, from: FAKE_USDT, to: ME, value: '5000000000', type: 'Transfer', token_info: { symbol: 'USDT', address: FAKE_USDT, decimals: 6 } },
          { transaction_id: 'c'.repeat(64), block_timestamp: ts + 2000, from: SCAM, to: ME, value: '0', type: 'Transfer', token_info: { symbol: 'USDT', address: USDT, decimals: 6 } },
        ],
      }
      if (url.includes('/transactions?')) return {
        success: true, data: [{
          txID: 'd'.repeat(64), block_timestamp: ts + 3000, ret: [{ contractRet: 'SUCCESS' }],
          raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 25_000_000, owner_address: '41' + '11'.repeat(20), to_address: '41' + '22'.repeat(20) } } }] },
        }],
      }
      return { success: true, data: [{ balance: 12_500_000 }] }
    })
    const r = await traceTronAddress(ME)
    expect(r.balance).toBe(12.5)
    const byTx = Object.fromEntries(r.rawTxs.map(t => [t.txid[0], t]))
    expect(byTx.a).toMatchObject({ asset: 'USDT', chain: 'tron', outputs: [{ address: ME, amount: 5000 }] })
    expect(byTx.b.asset).toBe('USDT*')
    expect(byTx.c).toBeUndefined() // zero-value spam hidden
    expect(byTx.d).toMatchObject({ asset: 'TRX', inputs: [{ address: ME }], outputs: [{ address: SCAM, amount: 25 }] })
    expect(r.nextCursor).toBe('-~fpTRC') // TRX list finished, TRC-20 has more
    expect(r.warnings?.join(' ')).toMatch(/fake tokens/)
  })
})

describe('fetchTronTx', () => {
  it('decodes TRX and TRC-20 Transfer logs', async () => {
    mockFetch((url, body) => {
      if (url.endsWith('/wallet/gettransactionbyid')) return {
        txID: 'e'.repeat(64), ret: [{ contractRet: 'SUCCESS' }],
        raw_data: { timestamp: ts, contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: ME, contract_address: USDT } } }] },
      }
      if (url.endsWith('/wallet/gettransactioninfobyid')) return {
        id: 'e'.repeat(64), blockTimeStamp: ts, receipt: { result: 'SUCCESS' },
        log: [{ address: USDT_HEX.slice(2), topics: ['ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0'.repeat(24) + '11'.repeat(20), '0'.repeat(24) + '22'.repeat(20)], data: (1234_500000).toString(16).padStart(64, '0') }],
      }
      throw new Error(`unexpected ${url} ${body}`)
    })
    const l = await fetchTronTx('E'.repeat(64))
    expect(l.chain).toBe('tron')
    expect(l.transfers).toHaveLength(1)
    expect(l.transfers[0]).toMatchObject({ asset: 'USDT', inputs: [{ address: ME }], outputs: [{ address: SCAM, amount: 1234.5 }] })
  })
})
