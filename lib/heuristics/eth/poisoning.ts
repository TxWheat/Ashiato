import { EntityLabel, Finding, RawTransaction } from '../../types'

// Address-poisoning detection.
//
// The scam: an attacker generates an address whose first and last characters
// match someone the victim really pays, then uses a fake token contract (or a
// zero-value transfer) to write a look-alike payment into the victim's history.
// Victims who later copy "the same address" from their history pay the attacker.
//
// Signals, per counterparty of `address`:
//  - it only ever appears in fake-token transfers (asset marked "*") or
//    zero/dust transfers, and
//  - another counterparty shares its first 4 and last 4 hex characters.

const DUST = 1e-6

function fingerprint(a: string): string {
  // Tron: base58 is case-sensitive and always starts with T
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return `${a.slice(1, 5)}…${a.slice(-4)}`
  const h = a.toLowerCase().replace(/^0x/, '')
  return `${h.slice(0, 4)}…${h.slice(-4)}`
}

export function short(a: string): string {
  return `${a.slice(0, 8)}…${a.slice(-4)}`
}

export interface PoisoningResult {
  labels: Map<string, EntityLabel>
  finding?: Finding
}

export function detectPoisoning(address: string, txs: RawTransaction[]): PoisoningResult {
  const me = address.startsWith('0x') ? address.toLowerCase() : address
  const genuine = new Set<string>()
  const junk = new Set<string>()
  for (const t of txs) {
    if (t.chain !== 'eth' && t.chain !== 'tron') continue
    const from = t.inputs[0]?.address
    const to = t.outputs[0]?.address
    const other = from === me ? to : to === me ? from : undefined
    if (!other || other === me) continue
    const fake = t.asset.endsWith('*') || (t.outputs[0]?.amount ?? 0) <= DUST
    if (fake) junk.add(other)
    else genuine.add(other)
  }

  const byPrint = new Map<string, string[]>()
  for (const a of genuine) byPrint.set(fingerprint(a), [...(byPrint.get(fingerprint(a)) ?? []), a])

  const labels = new Map<string, EntityLabel>()
  const reasons: string[] = []
  for (const a of junk) {
    if (genuine.has(a)) continue
    const real = byPrint.get(fingerprint(a))?.find(r => r !== a)
    if (!real) continue
    labels.set(a, {
      name: `Address poisoning: look-alike of ${short(real)}`,
      type: 'scam',
      inferredBy: 'address-poisoning',
      confidence: 0.9,
    })
    if (reasons.length < 4) reasons.push(`${short(a)} imitates ${short(real)} using fake-token or zero-value transfers`)
  }

  return {
    labels,
    finding: labels.size
      ? {
          heuristic: 'address-poisoning',
          confidence: 0.9,
          reasons: [
            ...reasons,
            'These transfers were written into this address\'s history by an attacker; no real funds moved. Never copy a recipient address from transaction history.',
          ],
        }
      : undefined,
  }
}
