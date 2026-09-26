import 'server-only'
import { Chain } from '../types'
import { eq, supabase } from '../supabase'
import { encodeLabel, encodeVote } from './encode'
import { LabelMessage, Signed, VoteMessage } from './signed'
import { RawAttestation } from './trust'

// Signed community labels and votes in Supabase. Table: community_attestations

export interface SignedRow {
  uid: string
  kind: 'label' | 'vote'
  attester: string
  chain: string | null
  subject: string | null
  ref_uid: string | null
  message: LabelMessage | VoteMessage
  signature: string
  time: number
  revoked: boolean
  revocation: { message: unknown; signature: string } | null
}

const T = 'community_attestations'
const inList = (vs: string[]) => `in.(${vs.map(v => encodeURIComponent(v)).join(',')})`

export async function getSigned(uid: string): Promise<SignedRow | null> {
  const rows = await supabase<SignedRow[]>(`${T}?uid=${eq(uid)}&select=*`)
  return rows[0] ?? null
}

export async function insertSigned(uid: string, s: Extract<Signed, { kind: 'label' | 'vote' }>) {
  const m = s.message
  await supabase(T, {
    method: 'POST',
    // The same signed message twice is one row
    headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      uid, kind: s.kind, attester: m.attester, message: m, signature: s.signature, time: m.time,
      chain: s.kind === 'label' ? s.message.chain : null,
      subject: s.kind === 'label' ? s.message.subject : null,
      ref_uid: s.kind === 'vote' ? s.message.label : null,
    }),
  })
}

export async function revokeSigned(s: Extract<Signed, { kind: 'revoke' }>) {
  await supabase(`${T}?uid=${eq(s.message.uid)}&attester=${eq(s.message.attester)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ revoked: true, revocation: { message: s.message, signature: s.signature } }),
  })
}

/** How many labels and votes a wallet signed since a time (a simple spam limit) */
export async function countSince(attester: string, since: Date): Promise<number> {
  const rows = await supabase<unknown[]>(`${T}?attester=${eq(attester)}&created_at=gte.${encodeURIComponent(since.toISOString())}&select=uid&limit=1000`)
  return rows.length
}

/** Rows as the trust builder reads them; data is the ABI encoding of the signed fields */
const toRaw = (r: SignedRow): RawAttestation => ({
  id: r.uid as `0x${string}`,
  attester: r.attester,
  time: Number(r.time),
  revoked: r.revoked,
  refUID: r.ref_uid ?? '',
  data: r.kind === 'label' ? encodeLabel(r.message as LabelMessage) : encodeVote(r.message as VoteMessage),
})

const FIELDS = 'uid,kind,attester,chain,subject,ref_uid,message,signature,time,revoked,revocation'

export async function labelsFor(chain: Chain, subject: string): Promise<RawAttestation[]> {
  const rows = await supabase<SignedRow[]>(`${T}?kind=eq.label&chain=${eq(chain)}&subject=${eq(subject)}&revoked=is.false&select=${FIELDS}&order=time.desc&limit=200`)
  return rows.map(toRaw)
}

export async function votesOn(labelUids: string[]): Promise<RawAttestation[]> {
  if (!labelUids.length) return []
  const rows = await supabase<SignedRow[]>(`${T}?kind=eq.vote&ref_uid=${inList(labelUids)}&revoked=is.false&select=${FIELDS}&order=time.desc&limit=2000`)
  return rows.map(toRaw)
}
