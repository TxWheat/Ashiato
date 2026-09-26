import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLabel } from '@/lib/labels'
import { warmScamLists } from '@/lib/scam-lists'

describe('bridge and scam lists', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('labels bridge contracts as cross-chain bridges', () => {
    expect(getLabel('0x8731d54E9D02c286767d56ac03e8037C07e01e98', 'eth')).toMatchObject({ name: 'Stargate: Router', type: 'bridge' })
    expect(getLabel('0xc1d13492285eb664951e201bf7c80c7c6318a1b5', 'eth')?.type).toBe('bridge')
  })

  it("flags MyEtherWallet's darklisted scam addresses", () => {
    expect(getLabel('0x02f4a464eebb46a50dd087074d7a2cf3f5a3598b', 'eth')).toMatchObject({ type: 'scam', source: 'MyEtherWallet darklist (MIT)' })
  })

  it('never overrides an exchange label', () => {
    expect(getLabel('0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be', 'eth')?.type).toBe('exchange')
  })

  it('downloads the ScamSniffer list once and labels its addresses', async () => {
    const drainer = '0x1111111111111111111111111111111111111abc'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([drainer.toUpperCase().replace('0X', '0x')])))
    vi.stubGlobal('fetch', fetchMock)
    await warmScamLists()
    await warmScamLists()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLabel(drainer, 'eth')).toMatchObject({ type: 'scam', name: 'Phishing / wallet drainer (ScamSniffer)' })
  })
})
