import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { SCHEMAS } from '@/lib/attest/config'
import { checkLabel, decodeLabel, decodeVote, encodeLabel, encodeVote, LabelInput } from '@/lib/attest/encode'
import { buildCommunityLabels, RawAttestation } from '@/lib/attest/trust'
import { cleanSigned, Signed, typedData, uidOf, Unsigned, verifySigned } from '@/lib/attest/signed'

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

describe('signed labels', () => {
  const wallet = privateKeyToAccount(generatePrivateKey())
  const me = wallet.address.toLowerCase() as `0x${string}`
  const now = 1_800_000_000
  const sign = async (u: Unsigned) => ({ ...u, signature: await wallet.signTypedData(typedData(u) as Parameters<typeof wallet.signTypedData>[0]) }) as Signed
  const labelMsg: Unsigned = { kind: 'label', message: { ...label(), attester: me, time: now } }

  it('accepts a label signed by its attester, with a stable uid', async () => {
    const s = await sign(labelMsg)
    const clean = cleanSigned(JSON.parse(JSON.stringify(s)), now)
    expect(typeof clean).not.toBe('string')
    expect(await verifySigned(clean as Signed)).toBe(true)
    expect(uidOf(clean as Signed)).toBe(uidOf(labelMsg))
    expect(uidOf(labelMsg)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('rejects a tampered message or another wallet', async () => {
    const s = await sign(labelMsg)
    const tampered = { ...s, message: { ...s.message, category: 'exchange' } } as Signed
    expect(await verifySigned(tampered)).toBe(false)
    const other = { ...s, message: { ...s.message, attester: A } } as Signed
    expect(await verifySigned(other)).toBe(false)
  })

  it('refuses stale times, bad addresses and missing evidence', async () => {
    const s = await sign(labelMsg)
    expect(cleanSigned(s, now + 3600)).toMatch(/too old/)
    expect(cleanSigned({ ...s, message: { ...s.message, subject: 'nope' } }, now)).toMatch(/Not a valid/)
    expect(cleanSigned({ ...s, message: { ...s.message, evidence: '' } }, now)).toMatch(/needs evidence/)
    expect(cleanSigned({ ...s, kind: 'gossip' }, now)).toBe('Bad request')
  })

  it('checks votes and withdrawals', async () => {
    const vote = await sign({ kind: 'vote', message: { attester: me, time: now, label: uid(1), trust: 2, reason: '' } })
    expect(await verifySigned(cleanSigned(vote, now) as Signed)).toBe(true)
    expect(cleanSigned({ ...vote, message: { ...vote.message, trust: -1 } }, now)).toMatch(/why you dispute/)
    expect(cleanSigned({ ...vote, message: { ...vote.message, label: 'x' } }, now)).toBe('Bad request')
    const revoke = await sign({ kind: 'revoke', message: { attester: me, time: now, uid: uid(1) } })
    expect(await verifySigned(cleanSigned(revoke, now) as Signed)).toBe(true)
  })
})
