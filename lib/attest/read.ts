import 'server-only'
import { Chain } from '../types'
import { normaliseAddress } from '../detect-chain'
import { lookupEnsNames } from '../ens'
import { storeConfigured } from '../supabase'
import { labelsFor, votesOn } from './store'
import { buildCommunityLabels, CommunityLabel } from './trust'

/** Community labels for one address, with votes and trust scores */
export async function communityLabels(chain: Chain, address: string): Promise<CommunityLabel[]> {
  // Without storage (local dev) there are simply no labels yet
  if (!storeConfigured()) return []
  const subject = normaliseAddress(address, chain)
  const labels = await labelsFor(chain, subject)
  if (!labels.length) return []
  const votes = await votesOn(labels.map(l => l.id))
  const people = [...new Set([...labels, ...votes].map(a => a.attester.toLowerCase()))]
  const ens = await lookupEnsNames(people).catch(() => new Map<string, string>())
  return buildCommunityLabels(chain, subject, labels, votes, ens)
}
