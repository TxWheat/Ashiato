import { EntityLabel, RawTransaction, transferKey } from '../types'

// Address clustering with union-find.
//  - BTC common-input-ownership: every address that signs inputs of the same
//    (non-CoinJoin) transaction is controlled by one wallet.
//  - Deposit-address reuse (tutela / Victor, FC'20): every wallet that pays into
//    the same exchange deposit address belongs to the same exchange customer.

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  add(x: string) {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }
  keys() {
    return this.parent.keys()
  }
}

const DUST = 1e-6
const MAX_DEPOSIT_SENDERS = 20

/**
 * Labels that describe who controls an address (exchange, service, scam operator…) can
 * speak for the whole cluster. Per-address guesses can't: "look-alike of 0x…" (address
 * poisoning) is about that one decoy, and an inferred deposit address is one customer's.
 */
const speaksForOwner = (l?: EntityLabel) => !!l && l.type !== 'deposit' && !l.inferredBy

/** Shared infrastructure (bridges, routers, exchanges) pays many people's deposit addresses */
const SHARED = new Set(['exchange', 'service', 'defi', 'mixer', 'coinjoin', 'gambling'])
const isShared = (l?: EntityLabel) => !!l && (SHARED.has(l.type) || l.inferredBy === 'contract-name')

export interface Cluster {
  id: number
  members: string[]
  evidence: string[]
  /** Label inherited from a labelled member */
  label?: EntityLabel
}

export interface ClusterResult {
  clusters: Cluster[]
  byAddress: Map<string, Cluster>
}

export function clusterAddresses(
  txs: RawTransaction[],
  labels: Map<string, EntityLabel | undefined>
): ClusterResult {
  const uf = new UnionFind()
  const evidence = new Map<string, string[]>() // root-agnostic; merged at the end

  const note = (addr: string, e: string) => {
    const list = evidence.get(addr) ?? []
    if (list.length < 5) list.push(e)
    evidence.set(addr, list)
  }

  const seen = new Set<string>()
  for (const tx of txs) {
    if (seen.has(transferKey(tx))) continue
    seen.add(transferKey(tx))

    if (tx.chain === 'btc' && !tx.coinjoin && !tx.isCoinbase) {
      const addrs = [...new Set(tx.inputs.map(i => i.address).filter(Boolean))]
      if (addrs.length >= 2) {
        for (const a of addrs) uf.add(a)
        for (let k = 1; k < addrs.length; k++) uf.union(addrs[0], addrs[k])
        note(addrs[0], `Co-spent in ${tx.txid.slice(0, 10)}… (${addrs.length} input addresses)`)
      }
    }
  }

  // Deposit-address reuse: senders into the same inferred deposit address
  const depositSenders = new Map<string, Set<string>>()
  for (const tx of txs) {
    // Fake-token and dust spam into a deposit address says nothing about who owns the sender
    if (tx.asset.endsWith('*')) continue
    for (const o of tx.outputs) {
      if (labels.get(o.address)?.type !== 'deposit' || o.amount <= DUST) continue
      const set = depositSenders.get(o.address) ?? new Set()
      for (const i of tx.inputs) if (i.address && i.address !== o.address && !isShared(labels.get(i.address))) set.add(i.address)
      depositSenders.set(o.address, set)
    }
  }
  for (const [deposit, senders] of depositSenders) {
    const list = [...senders]
    // A deposit address serves one customer. Dozens of unrelated payers means it's really
    // a hot wallet or shared contract (misread as a deposit): clustering them would merge
    // thousands of strangers into one "owner"
    if (list.length < 2 || list.length > MAX_DEPOSIT_SENDERS) continue
    for (const a of list) uf.add(a)
    for (let k = 1; k < list.length; k++) uf.union(list[0], list[k])
    note(list[0], `All paid into the same exchange deposit address ${deposit.slice(0, 10)}…`)
  }

  // Materialise clusters with ≥2 members
  const groups = new Map<string, string[]>()
  for (const a of uf.keys()) {
    const r = uf.find(a)
    const g = groups.get(r) ?? []
    g.push(a)
    groups.set(r, g)
  }
  const clusters: Cluster[] = []
  const byAddress = new Map<string, Cluster>()
  let id = 1
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const ev = [...new Set(members.flatMap(m => evidence.get(m) ?? []))].slice(0, 8)
    const labelled = members.map(m => labels.get(m)).find(speaksForOwner)
    const c: Cluster = {
      id: id++,
      members: members.sort(),
      evidence: ev,
      label: labelled
        ? { ...labelled, inferredBy: 'cluster', name: `${labelled.name} (cluster)`, confidence: 0.8 }
        : undefined,
    }
    clusters.push(c)
    for (const m of members) byAddress.set(m, c)
  }
  return { clusters, byAddress }
}
