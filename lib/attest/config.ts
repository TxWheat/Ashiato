// Community labels: categories and the field layout of labels and votes.

/** Label categories an investigator can sign */
export const COMMUNITY_CATEGORIES = [
  'scam', 'phishing', 'hack', 'exchange-deposit', 'exchange', 'mixer', 'service', 'cleared',
] as const
export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number]

/** Categories that accuse someone: evidence is required */
export const ACCUSING: readonly CommunityCategory[] = ['scam', 'phishing', 'hack']

/** ABI layouts (EAS-compatible schemas, should labels be anchored on-chain later) */
export const SCHEMAS = {
  /** "this address is X" */
  label: 'string chain,string subject,string category,string name,string evidence,uint8 confidence',
  /** how trustworthy is a label: -2 wrong, -1 doubtful, +1 plausible, +2 confirmed */
  vote: 'int8 trust,string reason',
} as const
