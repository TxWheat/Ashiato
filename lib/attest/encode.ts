import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from 'viem'
import { Chain } from '../types'
import { normaliseAddress } from '../detect-chain'
import { isChain } from '../evm'
import { ACCUSING, COMMUNITY_CATEGORIES, CommunityCategory, SCHEMAS } from './config'

export interface LabelInput {
  chain: Chain
  subject: string
  category: CommunityCategory
  name: string
  /** Tx hashes, a report hash or a link; required for accusing categories */
  evidence: string
  /** 1–100 */
  confidence: number
}

export interface VoteInput {
  /** -2 wrong · -1 doubtful · +1 plausible · +2 confirmed */
  trust: -2 | -1 | 1 | 2
  reason: string
}

const P = {
  label: parseAbiParameters(SCHEMAS.label),
  vote: parseAbiParameters(SCHEMAS.vote),
}

/** Problems with a label before it is signed (empty = fine) */
export function checkLabel(l: LabelInput): string[] {
  const errs: string[] = []
  if (!COMMUNITY_CATEGORIES.includes(l.category)) errs.push('Pick a category')
  if (!l.name.trim()) errs.push('Give the label a name')
  if (l.name.length > 80) errs.push('Name: 80 characters at most')
  if (ACCUSING.includes(l.category) && !l.evidence.trim()) errs.push('Accusing an address needs evidence: tx hashes, a report hash or a link')
  if (l.evidence.length > 1000) errs.push('Evidence: 1000 characters at most')
  if (!(l.confidence >= 1 && l.confidence <= 100)) errs.push('Confidence must be 1–100')
  return errs
}

export function encodeLabel(l: LabelInput): `0x${string}` {
  return encodeAbiParameters(P.label, [l.chain, normaliseAddress(l.subject, l.chain), l.category, l.name.trim(), l.evidence.trim(), Math.round(l.confidence)])
}

export function decodeLabel(data: `0x${string}`): LabelInput | null {
  try {
    const [chain, subject, category, name, evidence, confidence] = decodeAbiParameters(P.label, data)
    if (!isChain(chain) || !COMMUNITY_CATEGORIES.includes(category as CommunityCategory)) return null
    return { chain: chain as Chain, subject: normaliseAddress(subject, chain as Chain), category: category as CommunityCategory, name, evidence, confidence }
  } catch {
    return null
  }
}

export function encodeVote(v: VoteInput): `0x${string}` {
  return encodeAbiParameters(P.vote, [v.trust, v.reason.trim()])
}

export function decodeVote(data: `0x${string}`): VoteInput | null {
  try {
    const [trust, reason] = decodeAbiParameters(P.vote, data)
    return [-2, -1, 1, 2].includes(trust) ? { trust: trust as VoteInput['trust'], reason } : null
  } catch {
    return null
  }
}
