import { Chain } from '../types'
import { normaliseAddress } from '../detect-chain'
import { CommunityCategory } from './config'
import { decodeLabel, decodeVote, VoteInput } from './encode'

// Turns raw EAS attestations into community labels with a trust score.
// Rules (docs/HACKATHON_PLAN.md):
//   - one live label per attester per address and category: their latest wins
//   - one live vote per wallet per label: their latest wins; you can't vote on your own label
//   - trust = weighted share of support; the label's creator counts as a +2 vote
//   - voter weight = 1, +1 with a verified ENS name

/** An attestation as the EAS indexer returns it */
export interface RawAttestation {
  id: `0x${string}`
  attester: string
  /** Unix seconds */
  time: number
  revoked: boolean
  refUID: string
  data: `0x${string}`
}

export interface CommunityVote extends VoteInput {
  uid: string
  voter: string
  voterName?: string
  weight: number
  time: number
}

export type TrustStatus = 'trusted' | 'contested' | 'disputed'

export interface CommunityLabel {
  uid: string
  chain: Chain
  subject: string
  category: CommunityCategory
  name: string
  evidence: string
  confidence: number
  attester: string
  attesterName?: string
  time: number
  votes: CommunityVote[]
  /** 0–100: weighted share of support, creator included */
  trust: number
  support: number
  disputes: number
  status: TrustStatus
}

export const voterWeight = (address: string, ensNames: Map<string, string>) => 1 + (ensNames.has(address.toLowerCase()) ? 1 : 0)

export function trustStatus(trust: number): TrustStatus {
  return trust >= 70 ? 'trusted' : trust >= 40 ? 'contested' : 'disputed'
}

/** Latest live attestation per key */
function latestBy<T extends RawAttestation>(items: T[], key: (a: T) => string): T[] {
  const best = new Map<string, T>()
  for (const a of items) {
    if (a.revoked) continue
    const k = key(a)
    const cur = best.get(k)
    if (!cur || a.time > cur.time || (a.time === cur.time && a.id > cur.id)) best.set(k, a)
  }
  return [...best.values()]
}

export function buildCommunityLabels(
  chain: Chain,
  subject: string,
  labels: RawAttestation[],
  votes: RawAttestation[],
  ensNames: Map<string, string> = new Map()
): CommunityLabel[] {
  const target = normaliseAddress(subject, chain)
  const decoded = labels.flatMap(a => {
    const l = decodeLabel(a.data)
    return l && l.chain === chain && l.subject === target ? [{ ...a, attester: a.attester.toLowerCase(), label: l }] : []
  })
  const live = latestBy(decoded, a => `${a.attester}|${a.label.category}`)
  const ids = new Set(live.map(l => l.id.toLowerCase()))

  const decodedVotes = votes.flatMap(a => {
    const v = decodeVote(a.data)
    const ref = a.refUID.toLowerCase()
    return v && ids.has(ref) ? [{ ...a, attester: a.attester.toLowerCase(), refUID: ref, vote: v }] : []
  })
  const liveVotes = latestBy(decodedVotes, a => `${a.attester}|${a.refUID}`)

  return live.map(l => {
    const own = liveVotes.filter(v => v.refUID === l.id.toLowerCase() && v.attester !== l.attester)
    const cv: CommunityVote[] = own.map(v => ({
      uid: v.id, voter: v.attester, voterName: ensNames.get(v.attester), weight: voterWeight(v.attester, ensNames),
      time: v.time, trust: v.vote.trust, reason: v.vote.reason,
    })).sort((a, b) => b.time - a.time)
    const creator = voterWeight(l.attester, ensNames) * 2
    const pos = creator + cv.filter(v => v.trust > 0).reduce((s, v) => s + v.trust * v.weight, 0)
    const neg = cv.filter(v => v.trust < 0).reduce((s, v) => s - v.trust * v.weight, 0)
    const trust = Math.round((100 * pos) / (pos + neg))
    return {
      uid: l.id, chain, subject: target, category: l.label.category, name: l.label.name, evidence: l.label.evidence,
      confidence: l.label.confidence, attester: l.attester, attesterName: ensNames.get(l.attester), time: l.time,
      votes: cv, trust, support: cv.filter(v => v.trust > 0).length, disputes: cv.filter(v => v.trust < 0).length,
      status: trustStatus(trust),
    }
  }).sort((a, b) => b.trust - a.trust || b.votes.length - a.votes.length || b.time - a.time)
}
