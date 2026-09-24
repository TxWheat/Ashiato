export type Chain = 'btc' | 'eth'

export type EntityType =
  | 'exchange'
  | 'deposit'     // exchange customer deposit address (inferred)
  | 'mixer'
  | 'coinjoin'
  | 'sanctioned'
  | 'scam'
  | 'hack'
  | 'ransomware'
  | 'illicit'     // terrorism financing / extremism
  | 'darknet'
  | 'gambling'
  | 'defi'
  | 'miner'
  | 'service'
  | 'wallet'
  | 'unknown'

export interface EntityLabel {
  name: string
  type: EntityType
  /** Where the label came from (dataset title) */
  source?: string
  sourceUrl?: string
  /** Set when the label was inferred by a heuristic rather than looked up */
  inferredBy?: string
  confidence?: number
}

/** Every heuristic returns its verdict with a confidence and human-readable reasons */
export interface Finding {
  heuristic: string
  confidence: number
  reasons: string[]
}

export type RiskLevel = 'clean' | 'low' | 'medium' | 'high' | 'critical'

export interface RiskResult {
  score: number // 0-100
  level: RiskLevel
  reasons: string[]
}

export interface TxIO {
  address: string
  /** Amount in whole units of `asset` (BTC, ETH, USDT…) */
  amount: number
  /** BTC only: output index (outputs) or `prevTxid:vout` (inputs) */
  index?: number
  prev?: string
  scriptType?: string
  isChange?: boolean
  change?: Finding
}

export type CoinJoinKind = 'whirlpool' | 'wasabi1' | 'wasabi2' | 'joinmarket' | 'generic'

export interface CoinJoinFinding extends Finding {
  kind: CoinJoinKind
}

export interface RawTransaction {
  txid: string
  timestamp: number
  chain: Chain
  /** BTC, ETH, or ERC-20 token symbol */
  asset: string
  /** ETH: 'normal' | 'internal' | 'token' */
  kind?: 'normal' | 'internal' | 'token'
  /** ETH: distinguishes several transfers inside one tx (token logIndex / internal traceId) */
  eventId?: string
  inputs: TxIO[]
  outputs: TxIO[]
  fee?: number
  isCoinbase?: boolean
  coinjoin?: CoinJoinFinding
  /** ETH: gas price in gwei (used by the Tornado gas-price reveal) */
  gasPriceGwei?: number
  /** ETH: failed transactions are dropped, so this is always false when present */
  failed?: boolean
}

/** Unique identity of one transfer (a tx hash can carry several) */
export function transferKey(tx: RawTransaction): string {
  return `${tx.txid}:${tx.kind ?? ''}:${tx.eventId ?? ''}:${tx.asset}:${tx.inputs[0]?.address ?? ''}:${tx.outputs[0]?.address ?? ''}`
}

export interface NodeData {
  address: string
  chain: Chain
  label?: EntityLabel
  /** Verified ENS primary name (ETH) */
  ens?: string
  balance: number
  txCount: number
  isOrigin: boolean
  isExpanded?: boolean
  risk?: RiskResult
  findings?: Finding[]
  clusterId?: number
  /** Taint currently attributed to this address, in the taint asset */
  taint?: number
  note?: string
}

export interface EdgeData {
  id: string
  source: string
  target: string
  amount: number
  asset: string
  txid: string
  txids?: string[]
  timestamp: number
  chain: Chain
  isChange?: boolean
  txCount?: number
}

export interface TraceResult {
  address: string
  chain: Chain
  balance: number
  /** Total on-chain tx count if known (BTC), otherwise the number loaded */
  txCount: number
  nodes: NodeData[]
  edges: EdgeData[]
  entity?: EntityLabel
  rawTxs: RawTransaction[]
  /** Pass back as ?cursor= to load the next page */
  nextCursor?: string
  findings: Finding[]
  risk: RiskResult
  /** Non-fatal notes for the user (e.g. "token transfers unavailable") */
  warnings?: string[]
}

/** One transaction looked up directly (search by txid / hash) */
export interface TxLookup {
  chain: Chain
  txid: string
  timestamp: number
  /** BTC: one entry. ETH: one per value transfer inside the tx */
  transfers: RawTransaction[]
  labels: Record<string, EntityLabel>
  ens: Record<string, string>
  failed?: boolean
  warnings?: string[]
  /** BTC: spender txid per output (null = unspent) */
  spentBy?: (string | null)[]
}
