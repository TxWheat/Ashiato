import type { WalletClient } from 'viem'
import { normaliseAddress } from '../detect-chain'
import { checkLabel, LabelInput, VoteInput } from './encode'
import { typedData, Unsigned } from './signed'

// Signing community labels in the browser with the connected wallet. A signature, not a
// transaction: free, and it works on any network the wallet is on.

type Hex = `0x${string}`

async function signAndSend(wallet: WalletClient, s: Unsigned): Promise<{ uid: string }> {
  if (!wallet.account) throw new Error('Connect a wallet first')
  const signature = await wallet.signTypedData({ account: wallet.account, ...typedData(s) } as Parameters<WalletClient['signTypedData']>[0])
    .catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(/user rejected|denied|cancel/i.test(msg) ? 'Cancelled in your wallet' : msg)
    })
  const res = await fetch('/api/community', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...s, signature }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Could not save')
  return body
}

const base = (wallet: WalletClient) => ({ attester: wallet.account!.address.toLowerCase() as Hex, time: Math.floor(Date.now() / 1000) })

export function signLabel(wallet: WalletClient, l: LabelInput) {
  const errs = checkLabel(l)
  if (errs.length) throw new Error(errs.join('. '))
  return signAndSend(wallet, { kind: 'label', message: {
    ...base(wallet), chain: l.chain, subject: normaliseAddress(l.subject, l.chain), category: l.category,
    name: l.name.trim(), evidence: l.evidence.trim(), confidence: Math.round(l.confidence),
  } })
}

/** Your latest vote on a label replaces your earlier one */
export function signVote(wallet: WalletClient, label: Hex, v: VoteInput) {
  if (v.trust < 0 && !v.reason.trim()) throw new Error('Say why you dispute this label')
  return signAndSend(wallet, { kind: 'vote', message: { ...base(wallet), label, trust: v.trust, reason: v.reason.trim() } })
}

/** Withdraw your own label or vote */
export function signRevoke(wallet: WalletClient, uid: Hex) {
  return signAndSend(wallet, { kind: 'revoke', message: { ...base(wallet), uid } })
}
