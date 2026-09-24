import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { traceBtcAddress } from '@/lib/chains/btc'
import { traceEthAddress } from '@/lib/chains/eth'

const calls: string[] = []

function mockFetch(routes: [RegExp, unknown][]) {
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const hit = routes.find(([re]) => re.test(url))
    if (!hit) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(hit[1]), { status: 200 })
  })
}

beforeEach(() => {
  calls.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ETHERSCAN_API_KEY
})

const ME = 'bc1qmeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const BINANCE = '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo'

function esploraTx(i: number, vin: [string, number][], vout: [string, number][]) {
  return {
    txid: i.toString(16).padStart(64, '0'),
    fee: 1000,
    status: { confirmed: true, block_time: 1_700_000_000 + i },
    vin: vin.map(([a, v], k) => ({ txid: 'f'.repeat(63) + k, vout: 0, prevout: { scriptpubkey_address: a, scriptpubkey_type: 'v0_p2wpkh', value: v } })),
    vout: vout.map(([a, v]) => ({ scriptpubkey_address: a, scriptpubkey_type: a.startsWith('3') ? 'p2sh' : 'v0_p2wpkh', value: v })),
  }
}

describe('traceBtcAddress', () => {
  it('parses Esplora, labels counterparties and pages with the last confirmed txid', async () => {
    const txs = Array.from({ length: 25 }, (_, i) =>
      esploraTx(i + 1, [[ME, 200_000_000]], [[BINANCE, 100_000_000], [ME, 99_990_000]]))
    mockFetch([
      [/\/address\/bc1q[^/]+$/, { chain_stats: { funded_txo_sum: 5e8, spent_txo_sum: 2e8, tx_count: 80 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }],
      [/\/txs$/, txs],
    ])
    const r = await traceBtcAddress(ME)
    expect(r.balance).toBe(3)
    expect(r.txCount).toBe(80)
    expect(r.nextCursor).toBe(txs[24].txid)
    expect(r.nodes.find(n => n.address === BINANCE)?.label?.type).toBe('exchange')
    const edge = r.edges.find(e => e.target === BINANCE)!
    expect(edge.amount).toBeCloseTo(25)
    expect(edge.txCount).toBe(25)
    // Change back to self is detected and produces no self-edge
    expect(r.rawTxs[0].outputs[1].isChange).toBe(true)
    expect(r.edges.some(e => e.source === e.target)).toBe(false)
    // Every spend goes to Binance → inferred deposit address
    expect(r.findings.map(f => f.heuristic)).toContain('deposit-address')
    expect(r.entity?.type).toBe('deposit')
  })

  it('requests the next page with the cursor', async () => {
    mockFetch([
      [/\/address\/bc1q[^/]+$/, { chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } }],
      [/\/txs\/chain\/abc/, []],
    ])
    await traceBtcAddress(ME, 'abc')
    expect(calls.some(u => u.endsWith(`/address/${ME}/txs/chain/abc`))).toBe(true)
  })
})

describe('traceEthAddress', () => {
  const ADDR = '0x1111111111111111111111111111111111111111'
  const REAL_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'

  it('explains a missing API key', async () => {
    await expect(traceEthAddress(ADDR)).rejects.toThrow(/ETHERSCAN_API_KEY/)
  })

  it('uses Etherscan V2 with chainid and merges normal, internal and token transfers', async () => {
    process.env.ETHERSCAN_API_KEY = 'k'
    mockFetch([
      [/action=balance/, { status: '1', message: 'OK', result: '1500000000000000000' }],
      [/action=txlist&/, { status: '1', message: 'OK', result: [
        { hash: '0xa', from: '0x2222222222222222222222222222222222222222', to: ADDR, value: '2000000000000000000', timeStamp: '100', isError: '0', gasPrice: '20000000000' },
        { hash: '0xfail', from: ADDR, to: '0x3333333333333333333333333333333333333333', value: '1', timeStamp: '101', isError: '1' },
      ] }],
      [/action=txlistinternal/, { status: '0', message: 'No transactions found', result: [] }],
      [/action=tokentx/, { status: '1', message: 'OK', result: [
        { hash: '0xb', from: ADDR, to: '0x4444444444444444444444444444444444444444', value: '2500000000', timeStamp: '102', tokenSymbol: 'USDT', tokenDecimal: '6', contractAddress: REAL_USDT },
        { hash: '0xc', from: '0x5555555555555555555555555555555555555555', to: ADDR, value: '9000000', timeStamp: '103', tokenSymbol: 'USDT', tokenDecimal: '6', contractAddress: '0x9999999999999999999999999999999999999999' },
        { hash: '0xd', from: '0x6666666666666666666666666666666666666666', to: ADDR, value: '0', timeStamp: '104', tokenSymbol: 'USDT', tokenDecimal: '6', contractAddress: REAL_USDT },
      ] }],
    ])
    const r = await traceEthAddress(ADDR.toUpperCase().replace('0X', '0x'))
    const etherscanCalls = calls.filter(u => u.includes('etherscan'))
    // balance + txlist + txlistinternal + tokentx, plus a best-effort label lookup
    expect(etherscanCalls.filter(u => /module=account/.test(u)).length).toBe(4)
    expect(etherscanCalls.every(u => u.startsWith('https://api.etherscan.io/v2/api?chainid=1&'))).toBe(true)
    expect(r.address).toBe(ADDR)
    expect(r.balance).toBe(1.5)
    expect(r.rawTxs.map(t => t.txid)).toEqual(['0xc', '0xb', '0xa']) // failed + zero-value dropped
    expect(r.rawTxs.find(t => t.txid === '0xb')!.outputs[0].amount).toBe(2500)
    expect(r.rawTxs.find(t => t.txid === '0xc')!.asset).toBe('USDT*')
    expect(r.edges.find(e => e.asset === 'USDT')?.amount).toBe(2500)
    expect(r.warnings?.join(' ')).toMatch(/address-poisoning/)
    expect(r.warnings?.join(' ')).toMatch(/fake tokens/)
  })

  it('keeps several identical transfers inside one transaction (distinct logIndex)', async () => {
    process.env.ETHERSCAN_API_KEY = 'k'
    const DUP = '0x8888888888888888888888888888888888888888' // fresh address: responses are cached per URL
    const tok = (logIndex: string) => ({ hash: '0xdup', from: '0x0000000000000000000000000000000000000000', to: DUP, value: '1000000', timeStamp: '100', tokenSymbol: 'USDC', tokenDecimal: '6', contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', logIndex })
    mockFetch([
      [/action=balance/, { status: '1', message: 'OK', result: '0' }],
      [/action=tokentx/, { status: '1', message: 'OK', result: [tok('7'), tok('9')] }],
      [/action=/, { status: '0', message: 'No transactions found', result: [] }],
    ])
    const r = await traceEthAddress(DUP)
    expect(r.rawTxs.map(t => t.eventId)).toEqual(['7', '9'])
    expect(r.edges.find(e => e.asset === 'USDC')?.amount).toBe(2)
  })

  it('retries Etherscan rate-limit replies and never caches them', async () => {
    process.env.ETHERSCAN_API_KEY = 'k'
    const RL = '0x7676767676767676767676767676767676767676'
    let balanceCalls = 0
    vi.stubGlobal('fetch', async (u: string) => {
      calls.push(u)
      if (/action=balance/.test(u)) {
        balanceCalls++
        const body = balanceCalls === 1
          ? { status: '0', message: 'NOTOK', result: 'Max calls per sec rate limit reached (3/sec)' }
          : { status: '1', message: 'OK', result: '2000000000000000000' }
        return new Response(JSON.stringify(body))
      }
      return new Response(JSON.stringify({ status: '0', message: 'No transactions found', result: [] }))
    })
    const r = await traceEthAddress(RL)
    expect(balanceCalls).toBe(2)
    expect(r.balance).toBe(2)
  }, 15000)

  it('surfaces Etherscan errors', async () => {
    process.env.ETHERSCAN_API_KEY = 'k'
    mockFetch([
      [/action=balance/, { status: '0', message: 'NOTOK', result: 'Invalid API Key' }],
      [/action=/, { status: '0', message: 'NOTOK', result: 'Invalid API Key' }],
    ])
    await expect(traceEthAddress('0x7777777777777777777777777777777777777777')).rejects.toThrow(/Invalid API Key/)
  })
})
