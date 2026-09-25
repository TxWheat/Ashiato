import { encodePacked, keccak256, zeroAddress } from 'viem'

// On-chain community labels via EAS (Ethereum Attestation Service).
// One place to change network: Sepolia now, Base (Sepolia) later.

export const ATTEST_CHAIN = {
  id: 11155111,
  name: 'Sepolia',
  /** EAS v0.26 on Sepolia */
  eas: '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
  schemaRegistry: '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0',
  explorer: 'https://sepolia.easscan.org',
  graphql: 'https://sepolia.easscan.org/graphql',
} as const

/** Label categories an investigator can attest */
export const COMMUNITY_CATEGORIES = [
  'scam', 'phishing', 'hack', 'exchange-deposit', 'exchange', 'mixer', 'service', 'cleared',
] as const
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]

/** Categories that accuse someone: evidence is required */
export const ACCUSING: readonly CommunityCategory[] = ['scam', 'phishing', 'hack']

export const SCHEMAS = {
  /** "this address is X" */
  label: 'string chain,string subject,string category,string name,string evidence,uint8 confidence',
  /** how trustworthy is a label (refUID = the label): -2 wrong, -1 doubtful, +1 plausible, +2 confirmed */
  vote: 'int8 trust,string reason',
  /** "this trace report existed, unaltered, at this time" */
  report: 'bytes32 reportHash,string chain,string subject,string summary',
} as const
export type SchemaName = keyof typeof SCHEMAS

export const RESOLVER = zeroAddress
export const REVOCABLE = true

/** EAS schema UID = keccak256(abi.encodePacked(schema, resolver, revocable)): known before registering */
export function schemaUid(schema: string, resolver: `0x${string}` = RESOLVER, revocable = REVOCABLE): `0x${string}` {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]))
}

export const SCHEMA_UID: Record<SchemaName, `0x${string}`> = {
  label: schemaUid(SCHEMAS.label),
  vote: schemaUid(SCHEMAS.vote),
  report: schemaUid(SCHEMAS.report),
}

export const attestationUrl = (uid: string) => `${ATTEST_CHAIN.explorer}/attestation/view/${uid}`
