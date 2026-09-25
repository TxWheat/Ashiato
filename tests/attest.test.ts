import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from 'viem'
import { ATTEST_CHAIN, SCHEMA_UID, SCHEMAS, schemaUid } from '@/lib/attest/config'
import { checkLabel, decodeLabel, decodeVote, encodeLabel, encodeVote, LabelInput } from '@/lib/attest/encode'
import { buildCommunityLabels, RawAttestation } from '@/lib/attest/trust'
import { EAS_ABI, uidFromLogs } from '@/lib/attest/write'

const SCAMMER = '0x1111111111111111111111111111111111111111'
const A = '0xaaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const C = '0xcccc000000000000000000000000000000000003'
const D = '0xdddd000000000000000000000000000000000004'

const label = (over: Partial<LabelInput> = {}): LabelInput => ({
  chain: 'eth', subject: SCAMMER, category: 'scam', name: 'Fake USDT platform', evidence: '0xabc…', confidence: 80, ...over,
})
const uid = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`
const att = (id: number, attester: string, time: number, data: `0x${string}`, refUID = uid(0), revoked = false): RawAttestation =>
  ({ id: uid(id), attester, time, revoked, refUID, data })

describe('schemas', () => {
  it('has a stable UID per schema, different per schema', () => {
    expect(SCHEMA_UID.label).toBe(schemaUid(SCHEMAS.label))
    expect(new Set(Object.values(SCHEMA_UID)).size).toBe(3)
    expect(SCHEMA_UID.label).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('round-trips a label, normalising the address', () => {
    const d = decodeLabel(encodeLabel(label({ subject: SCAMMER.toUpperCase().replace('0X', '0x') })))
    expect(d).toEqual(label())
  })

  it('rejects junk data and unknown categories', () => {
    expect(decodeLabel('0x1234')).toBeNull()
    const bad = encodeAbiParameters(parseAbiParameters(SCHEMAS.label), ['eth', SCAMMER, 'gossip', 'x', '', 50])
    expect(decodeLabel(bad)).toBeNull()
  })

  it('round-trips a vote', () => {
    expect(decodeVote(encodeVote({ trust: -2, reason: 'This is the MetaMask router' }))).toEqual({ trust: -2, reason: 'This is the MetaMask router' })
  })

  it('needs evidence to accuse, not to mark an exchange', () => {
    expect(checkLabel(label({ evidence: '' }))).toContain('Accusing an address needs evidence: tx hashes, a report hash or a link')
    expect(checkLabel(label({ category: 'exchange-deposit', evidence: '' }))).toEqual([])
    expect(checkLabel(label({ name: ' ' })).length).toBe(1)
  })
})

describe('trust', () => {
  const L = encodeLabel(label())

  it('a fresh label is trusted by its creator alone', () => {
    const [l] = buildCommunityLabels('eth', SCAMMER, [att(1, A, 100, L)], [])
    expect(l).toMatchObject({ trust: 100, status: 'trusted', support: 0, disputes: 0, attester: A })
  })

  it('weighs votes; ENS names count double', () => {
    const votes = [
      att(10, B, 200, encodeVote({ trust: 2, reason: '' }), uid(1)),
      att(11, C, 201, encodeVote({ trust: -2, reason: 'wrong' }), uid(1)),
      att(12, D, 202, encodeVote({ trust: -1, reason: 'unsure' }), uid(1)),
    ]
    // pos = creator 2 + B 2 = 4; neg = C 2 + D 1 = 3 → 57%
    const [plain] = buildCommunityLabels('eth', SCAMMER, [att(1, A, 100, L)], votes)
    expect(plain).toMatchObject({ trust: 57, status: 'contested', support: 1, disputes: 2 })
    // C has ENS: neg = 4 + 1 = 5 → 44%
    const [ens] = buildCommunityLabels('eth', SCAMMER, [att(1, A, 100, L)], votes, new Map([[C, 'sleuth.eth']]))
    expect(ens.trust).toBe(44)
    expect(ens.votes.find(v => v.voter === C)?.voterName).toBe('sleuth.eth')
  })

  it("keeps each wallet's latest vote, and ignores voting on your own label", () => {
    const votes = [
      att(10, B, 200, encodeVote({ trust: -2, reason: 'no' }), uid(1)),
      att(11, B, 300, encodeVote({ trust: 2, reason: '' }), uid(1)),
      att(12, A, 300, encodeVote({ trust: 2, reason: '' }), uid(1)),
    ]
    const [l] = buildCommunityLabels('eth', SCAMMER, [att(1, A, 100, L)], votes)
    expect(l.votes.map(v => [v.voter, v.trust])).toEqual([[B, 2]])
  })

  it('drops revoked labels and votes, and labels for other addresses', () => {
    const other = encodeLabel(label({ subject: '0x2222222222222222222222222222222222222222' }))
    const labels = [att(1, A, 100, L, uid(0), true), att(2, B, 100, other)]
    expect(buildCommunityLabels('eth', SCAMMER, labels, [])).toEqual([])
  })

  it("one live label per attester and category: the latest wins", () => {
    const newer = encodeLabel(label({ name: 'Pig-butchering ring' }))
    const ls = buildCommunityLabels('eth', SCAMMER, [att(1, A, 100, L), att(2, A, 200, newer)], [])
    expect(ls.map(l => l.name)).toEqual(['Pig-butchering ring'])
  })
})

describe('write helpers', () => {
  it('reads the new UID from the Attested event', () => {
    const newUid = uid(0xbeef)
    const topics = encodeEventTopics({ abi: EAS_ABI, eventName: 'Attested', args: { recipient: SCAMMER, attester: A, schemaUID: SCHEMA_UID.label } }) as `0x${string}`[]
    const data = encodeAbiParameters(parseAbiParameters('bytes32'), [newUid])
    expect(uidFromLogs([{ address: ATTEST_CHAIN.eas, data, topics }])).toBe(newUid)
    expect(uidFromLogs([{ address: A, data, topics }])).toBeUndefined()
  })
})

describe('wallet network ids', () => {
  it('reads numbers, hex and CAIP-2 text (Reown email wallets)', async () => {
    const { parseChainId } = await import('@/lib/attest/write')
    expect(parseChainId('eip155:1')).toBe(1)
    expect(parseChainId('eip155:11155111')).toBe(11155111)
    expect(parseChainId('0xaa36a7')).toBe(11155111)
    expect(parseChainId(11155111)).toBe(11155111)
    expect(parseChainId(1n)).toBe(1)
    expect(parseChainId('nonsense')).toBeUndefined()
  })
})
