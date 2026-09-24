import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEthTx } from '@/lib/chains/eth-tx'

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ETHERSCAN_API_KEY
})

const HASH = '0x' + 'ab'.repeat(32)
const FROM = '0x' + '1'.repeat(40)
const TO = '0x' + '2'.repeat(40)
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const FAKE = '0x' + '9'.repeat(40)
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const pad = (h: string) => h.replace(/^0x/, '').padStart(64, '0')
const str = (s: string) => '0x' + pad('20') + pad(s.length.toString(16)) + Buffer.from(s).toString('hex').padEnd(64, '0')

describe('fetchEthTx', () => {
  it('collects the ETH value, ERC-20 transfer events and internal transfers', async () => {
    process.env.ETHERSCAN_API_KEY = 'k'
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      if (url.includes('etherscan')) {
        return new Response(JSON.stringify({ status: '1', message: 'OK', result: [{ hash: HASH, from: TO, to: FROM, value: '500000000000000000', timeStamp: '0', isError: '0', traceId: '0_1' }] }))
      }
      const calls = JSON.parse(init!.body!) as { id: number; method: string; params: [{ to: string; data: string }] }[]
      return new Response(JSON.stringify(calls.map(c => {
        let result: unknown = null
        if (c.method === 'eth_getTransactionByHash') result = { hash: HASH, from: FROM, to: TO, value: '0xde0b6b3a7640000', blockNumber: '0x10', gasPrice: '0x4a817c800' }
        if (c.method === 'eth_getTransactionReceipt') result = { status: '0x1', contractAddress: null, logs: [
          { address: USDT, topics: [TOPIC, '0x' + pad(FROM), '0x' + pad(TO)], data: '0x' + pad((2500n * 10n ** 6n).toString(16)), logIndex: '0x5' },
          { address: FAKE, topics: [TOPIC, '0x' + pad(FROM), '0x' + pad(TO)], data: '0x' + pad((10n ** 18n).toString(16)), logIndex: '0x6' },
        ] }
        if (c.method === 'eth_getBlockByNumber') result = { timestamp: '0x6500000' }
        if (c.method === 'eth_call') {
          const { to, data } = c.params[0]
          if (data === '0x95d89b41') result = str(to === USDT ? 'USDT' : 'USDC')
          else if (data === '0x313ce567') result = '0x' + pad(to === USDT ? '6' : '12')
          else result = '0x' + pad('0') // ENS lookups: no names
        }
        return { jsonrpc: '2.0', id: c.id, result }
      })))
    })

    const r = await fetchEthTx(HASH)
    expect(r.timestamp).toBe(0x6500000)
    const byAsset = Object.fromEntries(r.transfers.map(t => [`${t.kind}:${t.asset}`, t.outputs[0].amount]))
    expect(byAsset).toEqual({ 'normal:ETH': 1, 'token:USDT': 2500, 'token:USDC*': 1, 'internal:ETH': 0.5 })
    expect(r.transfers.find(t => t.asset === 'USDT')!.eventId).toBe('5')
    expect(r.failed).toBe(false)
  })
})
