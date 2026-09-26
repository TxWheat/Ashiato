import { hashTypedData, isAddress, isHex, verifyTypedData } from 'viem'
import { Chain } from '../types'
import { addressFits, normaliseAddress } from '../detect-chain'
import { checkLabel, LabelInput, VoteInput } from './encode'
import { CommunityCategory } from './config'

// Community labels and votes are EIP-712 messages signed by the investigator's wallet:
// free (no transaction, no network fee), and anyone can check who signed what.
// The domain has no chainId, so wallets sign on whatever network they are on.

export const DOMAIN = { name: 'Ashiato Community Labels', version: '1' } as const

export const TYPES = {
  Label: [
    { name: 'attester', type: 'address' },
    { name: 'chain', type: 'string' },
    { name: 'subject', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'evidence', type: 'string' },
    { name: 'confidence', type: 'uint8' },
    { name: 'time', type: 'uint64' },
  ],
  Vote: [
    { name: 'attester', type: 'address' },
    { name: 'label', type: 'bytes32' },
    { name: 'trust', type: 'int8' },
    { name: 'reason', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
  Revoke: [
    { name: 'attester', type: 'address' },
    { name: 'uid', type: 'bytes32' },
    { name: 'time', type: 'uint64' },
  ],
} as const

type Hex = `0x${string}`

/** Messages as JSON (time in unix seconds) */
export interface LabelMessage extends LabelInput { attester: Hex; time: number }
export interface VoteMessage extends VoteInput { attester: Hex; label: Hex; time: number }
export interface RevokeMessage { attester: Hex; uid: Hex; time: number }

export type Signed =
  | { kind: 'label'; message: LabelMessage; signature: Hex }
  | { kind: 'vote'; message: VoteMessage; signature: Hex }
  | { kind: 'revoke'; message: RevokeMessage; signature: Hex }
export type SignedKind = Signed['kind']
/** A message before signing */
export type Unsigned = { [K in SignedKind]: Omit<Extract<Signed, { kind: K }>, 'signature'> }[SignedKind]

/** The typed data a wallet signs for a message */
export function typedData(s: Unsigned) {
  const time = BigInt(s.message.time)
  if (s.kind === 'label') {
    const m = s.message
    return { domain: DOMAIN, types: { Label: TYPES.Label }, primaryType: 'Label' as const,
      message: { attester: m.attester, chain: m.chain, subject: m.subject, category: m.category, name: m.name, evidence: m.evidence, confidence: m.confidence, time } }
  }
  if (s.kind === 'vote') {
    const m = s.message
    return { domain: DOMAIN, types: { Vote: TYPES.Vote }, primaryType: 'Vote' as const,
      message: { attester: m.attester, label: m.label, trust: m.trust, reason: m.reason, time } }
  }
  const m = s.message
  return { domain: DOMAIN, types: { Revoke: TYPES.Revoke }, primaryType: 'Revoke' as const,
    message: { attester: m.attester, uid: m.uid, time } }
}

/** A label's or vote's id: the hash of what was signed */
export const uidOf = (s: Unsigned): Hex => hashTypedData(typedData(s) as Parameters<typeof hashTypedData>[0])

const MAX_SKEW = 10 * 60
const isUid = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v)

/**
 * Checks a signed message's shape and rebuilds it with only the known fields, normalised.
 * Returns an error message, or the clean message. The signature is checked separately.
 */
export function cleanSigned(body: unknown, now = Math.floor(Date.now() / 1000)): Signed | string {
  const b = body as { kind?: unknown; message?: Record<string, unknown>; signature?: unknown }
  const m = b?.message
  if (!m || typeof m !== 'object' || typeof b.signature !== 'string' || !isHex(b.signature) || b.signature.length > 2 + 2 * 4096) return 'Bad request'
  if (typeof m.attester !== 'string' || !isAddress(m.attester)) return 'Bad request'
  const attester = m.attester.toLowerCase() as Hex
  const time = Number(m.time)
  // The latest label or vote wins, so a signing time far from now is refused (no backdating)
  if (!Number.isInteger(time) || Math.abs(time - now) > MAX_SKEW) return 'The signature is too old or your clock is off. Try again.'
  const signature = b.signature as Hex

  if (b.kind === 'label') {
    const chain = m.chain as Chain
    const subject = String(m.subject ?? '').trim()
    if (!addressFits(subject, chain)) return `Not a valid ${String(m.chain).toUpperCase()} address`
    const message: LabelMessage = {
      attester, time, chain, subject: normaliseAddress(subject, chain),
      category: String(m.category) as CommunityCategory, name: String(m.name ?? ''), evidence: String(m.evidence ?? ''), confidence: Number(m.confidence),
    }
    const errs = checkLabel(message)
    if (errs.length) return errs.join('. ')
    // Signed exactly as sent: trimming here would break the signature, so untrimmed text is refused
    if (message.name !== message.name.trim() || message.evidence !== message.evidence.trim() || message.subject !== m.subject) return 'Bad request'
    return { kind: 'label', message, signature }
  }
  if (b.kind === 'vote') {
    const trust = Number(m.trust)
    const reason = String(m.reason ?? '')
    if (!isUid(m.label) || ![-2, -1, 1, 2].includes(trust)) return 'Bad request'
    if (reason.length > 300) return 'Reason: 300 characters at most'
    if (trust < 0 && !reason.trim()) return 'Say why you dispute this label'
    return { kind: 'vote', message: { attester, time, label: m.label, trust: trust as VoteInput['trust'], reason }, signature }
  }
  if (b.kind === 'revoke') {
    if (!isUid(m.uid)) return 'Bad request'
    return { kind: 'revoke', message: { attester, time, uid: m.uid }, signature }
  }
  return 'Bad request'
}

/** Signature check for ordinary wallets (EOAs); smart-contract wallets need an RPC call on top */
export function verifySigned(s: Signed): Promise<boolean> {
  return verifyTypedData({ address: s.message.attester, signature: s.signature, ...typedData(s) } as Parameters<typeof verifyTypedData>[0]).catch(() => false)
}
