import 'server-only'
import { Chain } from '../types'
import { normaliseAddress } from '../detect-chain'
import { fetchJson } from '../http'
import { lookupEnsNames } from '../ens'
import { ATTEST_CHAIN, SCHEMA_UID } from './config'
import { buildCommunityLabels, CommunityLabel, RawAttestation } from './trust'

// Reads community labels from the EAS indexer (GraphQL). EAS_GRAPHQL_URL points at a
// mock or another network's indexer.

const URL_ = process.env.EAS_GRAPHQL_URL || ATTEST_CHAIN.graphql
const FIELDS = 'id attester time revoked refUID data'

interface GqlResponse { data?: { attestations?: RawAttestation[] }; errors?: { message: string }[] }

async function query(q: string, variables: Record<string, unknown>, ttl: number): Promise<RawAttestation[]> {
  const res = await fetchJson<GqlResponse>(URL_, ttl, 2, undefined, {
    method: 'POST',
    body: JSON.stringify({ query: q, variables }),
    headers: { 'content-type': 'application/json' },
  })
  if (res.errors?.length) throw new Error(`EAS indexer: ${res.errors[0].message}`)
  return res.data?.attestations ?? []
}

/** Community labels for one address; fresh skips the short cache (right after you attest) */
export async function communityLabels(chain: Chain, address: string, fresh = false): Promise<CommunityLabel[]> {
  const subject = normaliseAddress(address, chain)
  const ttl = fresh ? 0 : 30
  // The indexer can't filter on a decoded field, so match the subject in the decoded JSON
  // and check it exactly after decoding
  const labels = await query(
    `query($schema: String!, $subject: String!) { attestations(where: { schemaId: { equals: $schema }, revoked: { equals: false }, decodedDataJson: { contains: $subject } }, orderBy: [{ time: desc }], take: 200) { ${FIELDS} } }`,
    { schema: SCHEMA_UID.label, subject },
    ttl
  )
  if (!labels.length) return []
  const votes = await query(
    `query($schema: String!, $refs: [String!]) { attestations(where: { schemaId: { equals: $schema }, revoked: { equals: false }, refUID: { in: $refs } }, orderBy: [{ time: desc }], take: 1000) { ${FIELDS} } }`,
    { schema: SCHEMA_UID.vote, refs: labels.map(l => l.id) },
    ttl
  )
  const people = [...new Set([...labels, ...votes].map(a => a.attester.toLowerCase()))]
  const ens = await lookupEnsNames(people).catch(() => new Map<string, string>())
  return buildCommunityLabels(chain, subject, labels, votes, ens)
}
