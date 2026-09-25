import { describe, expect, it } from 'vitest'
import { clusterAddresses } from '@/lib/heuristics/cluster'
import { EntityLabel, RawTransaction } from '@/lib/types'

const DEP = '0xdeadbeef000000000000000000000000000d0001'
const tx = (txid: string, from: string, amount: number, asset = 'ETH'): RawTransaction => ({
  txid, timestamp: 1, chain: 'eth', asset, inputs: [{ address: from, amount: 0 }], outputs: [{ address: DEP, amount }],
})
const deposit: EntityLabel = { name: 'Deposit address → HitBTC', type: 'deposit', inferredBy: 'deposit-address', confidence: 0.8 }

describe('deposit-reuse clustering', () => {
  const VICTIM_HOP = '0x32d37602000000000000000000000000000fcab8'
  const DECOY = '0x2c30aaaa00000000000000000000000000bb905e'
  const OTHER = '0x1111000000000000000000000000000000000001'
  const BRIDGE = '0xb685000000000000000000000000000000c0895b'

  it('fake-token and dust spam into a deposit address does not join the cluster', () => {
    const labels = new Map<string, EntityLabel | undefined>([[DEP, deposit]])
    const r = clusterAddresses([tx('a', VICTIM_HOP, 0.03), tx('b', DECOY, 5, 'USDT*'), tx('c', OTHER, 0)], labels)
    expect(r.clusters).toEqual([])
  })

  it('a poisoning guess about one member never labels the whole cluster', () => {
    const labels = new Map<string, EntityLabel | undefined>([
      [DEP, deposit],
      [OTHER, { name: 'Address poisoning: look-alike of 0x2c30d9…905e', type: 'scam', inferredBy: 'address-poisoning', confidence: 0.9 }],
    ])
    const r = clusterAddresses([tx('a', VICTIM_HOP, 0.03), tx('b', OTHER, 0.2)], labels)
    expect(r.byAddress.get(VICTIM_HOP)?.members).toContain(OTHER)
    expect(r.byAddress.get(VICTIM_HOP)?.label).toBeUndefined()
  })

  it('shared contracts (bridges, routers) are not clustered with their users', () => {
    const labels = new Map<string, EntityLabel | undefined>([
      [DEP, deposit],
      [BRIDGE, { name: 'Bridgers (verified contract)', type: 'service', inferredBy: 'contract-name', confidence: 0.7 }],
    ])
    const r = clusterAddresses([tx('a', VICTIM_HOP, 0.03), tx('b', BRIDGE, 0.9)], labels)
    expect(r.byAddress.has(BRIDGE)).toBe(false)
  })

  it('a dataset label still names the cluster', () => {
    const labels = new Map<string, EntityLabel | undefined>([[DEP, deposit], [OTHER, { name: 'Lazarus Group', type: 'sanctioned' }]])
    const r = clusterAddresses([tx('a', VICTIM_HOP, 0.03), tx('b', OTHER, 0.2)], labels)
    expect(r.byAddress.get(VICTIM_HOP)?.label?.name).toBe('Lazarus Group (cluster)')
  })
})

describe('hot wallets misread as deposit addresses', () => {
  it('many unrelated payers into one "deposit" are not merged', () => {
    const labels = new Map<string, EntityLabel | undefined>([[DEP, deposit]])
    const payers = Array.from({ length: 50 }, (_, i) => tx(`t${i}`, `0x${(i + 1).toString(16).padStart(40, '0')}`, 0.1))
    expect(clusterAddresses(payers, labels).clusters).toEqual([])
  })
})
