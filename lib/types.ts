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

export interface NodeData {
  address: string
  chain: Chain
  label?: EntityLabel
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
