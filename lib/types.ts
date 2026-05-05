export type Chain = 'btc' | 'eth'

export type EntityType = 'exchange' | 'mixer' | 'scam' | 'defi' | 'wallet' | 'unknown'

export interface EntityLabel {
  name: string
  type: EntityType
}

export interface NodeData {
  address: string
  chain: Chain
  label?: EntityLabel
  balance: number
  txCount: number
  isOrigin: boolean
  isExpanded?: boolean
}

export interface EdgeData {
  id: string
  source: string
  target: string
  amount: number
  txid: string
  timestamp: number
  chain: Chain
  isChange?: boolean
  txCount?: number
}

export interface TxOutput {
  address: string
  amount: number
  isChange?: boolean
}

export interface RawTransaction {
  txid: string
  timestamp: number
  fromAddresses: string[]
  outputs: TxOutput[]
  chain: Chain
}

export interface TraceResult {
  address: string
  chain: Chain
  balance: number
  txCount: number
  nodes: NodeData[]
  edges: EdgeData[]
  entity?: EntityLabel
  rawTxs: RawTransaction[]
}
