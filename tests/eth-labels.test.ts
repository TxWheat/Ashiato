import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyTag, etherscanLabel } from '@/lib/chains/eth-labels'

const calls: string[] = []
function mockFetch(route: (url: string) => unknown) {
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify(route(url)), { status: 200 })
  })
}
const A = (n: number) => '0x' + n.toString(16).padStart(40, '0')

beforeEach(() => {
  calls.length = 0
  process.env.ETHERSCAN_API_KEY = 'test'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ETHERSCAN_API_KEY
})

describe('classifyTag', () => {
  it('maps Etherscan tags onto entity types', () => {
    expect(classifyTag('Privacy Pools: Deposit Mixer')).toBe('mixer')
    expect(classifyTag('Tornado.Cash: Router')).toBe('mixer')
    expect(classifyTag('Binance 14 Exchange')).toBe('exchange')
    expect(classifyTag('Fake_Phishing1234 Phish / Hack')).toBe('scam')
    expect(classifyTag('Uniswap V3: Router')).toBe('service')
  })
})

// Order matters: the nametag endpoint switches itself off after a plan error
describe('etherscanLabel', () => {
  it('uses the public name tag when the plan allows it', async () => {
    mockFetch(u => u.includes('module=nametag')
      ? { status: '1', message: 'OK', result: [{ address: A(1), nametag: 'Privacy Pools: Deposit', labels: ['Mixer'] }] }
      : { status: '0', message: 'NOTOK', result: 'unexpected' })
    const l = await etherscanLabel(A(1))
    expect(l).toMatchObject({ name: 'Privacy Pools: Deposit', type: 'mixer' })
    expect(l?.inferredBy).toBeUndefined()
  })

  it('falls back to the verified contract name (resolving generic proxies) and stops asking for name tags on a plan error', async () => {
    const impl = A(99)
    mockFetch(u => {
      if (u.includes('module=nametag')) return { status: '0', message: 'NOTOK', result: 'Sorry, it looks like you are trying to access an API Pro endpoint. Contact us to upgrade to API Pro.' }
      if (u.includes(`address=${impl}`)) return { status: '1', message: 'OK', result: [{ ContractName: 'PrivacyPoolSimple', Proxy: '0' }] }
      return { status: '1', message: 'OK', result: [{ ContractName: 'ERC1967Proxy', Proxy: '1', Implementation: impl }] }
    })
    const l = await etherscanLabel(A(2))
    expect(l).toMatchObject({ name: 'PrivacyPoolSimple (verified contract)', type: 'mixer', inferredBy: 'contract-name' })

    calls.length = 0
    await etherscanLabel(A(3))
    expect(calls.some(u => u.includes('module=nametag'))).toBe(false)
  })

  it('returns nothing for plain wallets (no verified source)', async () => {
    mockFetch(() => ({ status: '1', message: 'OK', result: [{ ContractName: '', Proxy: '0' }] }))
    expect(await etherscanLabel(A(4))).toBeUndefined()
  })
})
