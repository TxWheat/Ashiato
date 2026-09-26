import { Chain } from '../types'

// Cross-chain swaps and bridges: money leaves one chain and arrives on another in a
// separate transaction. Services that expose their order records let us link the two.

export interface CrossChainHop {
  service: BridgeService
  orderId: string
  status: string
  /** Chain names as the service reports them, e.g. "ETH", "TRX", "BSC" */
  fromChainName: string
  toChainName: string
  /** Our chain when we can trace it (btc / eth / tron), else undefined */
  fromChain?: Chain
  toChain?: Chain
  fromAddress: string
  toAddress: string
  fromHash: string
  toHash?: string
  fromAmount: number
  fromAsset: string
  toAmount: number
  toAsset: string
  /** When Bridgers created the order, as it reports it (timezone not documented) */
  createdText?: string
  /** Unix seconds, when known from the chain (set by the page for matched transactions) */
  time?: number
  /** Explorer links as the service gives them */
  depositUrl?: string
  receiveUrl?: string
  refundHash?: string
  refundUrl?: string
}

const STATUS_TEXT: Record<string, string> = {
  receive_complete: 'Completed', complete: 'Completed', success: 'Completed',
  wait_deposit_send: 'Waiting for deposit', wait_exchange_push: 'Swapping', wait_receive_send: 'Paying out',
  refund_complete: 'Refunded', wait_refund_send: 'Refunding', timeout: 'Timed out', fail: 'Failed', error: 'Failed',
  // Across / Relay / deBridge
  filled: 'Completed', unfilled: 'Not filled yet', slowfillrequested: 'Being filled (slow)', pending: 'Pending', expired: 'Expired', refunded: 'Refunded', refund: 'Refunded', failure: 'Failed', waiting: 'Waiting',
  fulfilled: 'Completed', sentunlock: 'Completed', claimedunlock: 'Completed', ordercancelled: 'Cancelled', claimedordercancel: 'Cancelled', created: 'Waiting',
}
export const statusText = (s: string) => STATUS_TEXT[s.toLowerCase()] ?? s.replace(/_/g, ' ')
export const statusOk = (s: string) => /complete|success|^filled$|fulfilled|unlock/i.test(s) && !/refund|cancel/i.test(s)

export type BridgeService = 'Bridgers' | 'Across' | 'Relay' | 'deBridge'

/** Names that mark an address as a cross-chain service whose records we can look up */
export const BRIDGE_NAME = /bridgers|swft|omnibridge|allchain ?bridge|across protocol|^relay\b|debridge|\bdln\b/i

/** Which service to ask about a bridge address, from its label */
export function lookupService(name: string): BridgeService | undefined {
  if (/across protocol/i.test(name)) return 'Across'
  if (/^relay\b/i.test(name)) return 'Relay'
  if (/debridge|\bdln\b/i.test(name)) return 'deBridge'
  if (/bridgers|swft|omnibridge|allchain ?bridge/i.test(name)) return 'Bridgers'
  return undefined
}

const CHAIN_ALIASES: Record<string, Chain> = {
  ETH: 'eth', ETHEREUM: 'eth', ERC20: 'eth',
  TRX: 'tron', TRON: 'tron', TRC20: 'tron',
  BTC: 'btc', BITCOIN: 'btc',
}
export const toOurChain = (name: string): Chain | undefined => CHAIN_ALIASES[name.trim().toUpperCase()]

const CHAIN_DISPLAY: Record<string, string> = {
  ETH: 'Ethereum', TRX: 'Tron', TRON: 'Tron', BTC: 'Bitcoin', BSC: 'BNB Chain', POLYGON: 'Polygon', MATIC: 'Polygon',
  ARBITRUM: 'Arbitrum', ARB: 'Arbitrum', OPTIMISM: 'Optimism', OP: 'Optimism', BASE: 'Base', AVAX: 'Avalanche', SOL: 'Solana', SOLANA: 'Solana',
  ZKSYNC: 'zkSync Era', LINEA: 'Linea', SCROLL: 'Scroll', BLAST: 'Blast', GNOSIS: 'Gnosis', MANTLE: 'Mantle', UNICHAIN: 'Unichain', ZORA: 'Zora', MODE: 'Mode', WORLD: 'World Chain', HYPEREVM: 'HyperEVM', ROBINHOOD: 'Robinhood Chain', PLASMA: 'Plasma', FANTOM: 'Fantom',
}
export const chainDisplay = (name: string) => CHAIN_DISPLAY[name.trim().toUpperCase()] ?? name

const TX_EXPLORER: Record<string, string> = {
  ETH: 'https://etherscan.io/tx/', TRX: 'https://tronscan.org/#/transaction/', TRON: 'https://tronscan.org/#/transaction/',
  BTC: 'https://mempool.space/tx/', BSC: 'https://bscscan.com/tx/', POLYGON: 'https://polygonscan.com/tx/', MATIC: 'https://polygonscan.com/tx/',
  ARBITRUM: 'https://arbiscan.io/tx/', ARB: 'https://arbiscan.io/tx/', OPTIMISM: 'https://optimistic.etherscan.io/tx/', OP: 'https://optimistic.etherscan.io/tx/',
  BASE: 'https://basescan.org/tx/', AVAX: 'https://snowtrace.io/tx/', SOL: 'https://solscan.io/tx/', SOLANA: 'https://solscan.io/tx/',
  ZKSYNC: 'https://era.zksync.network/tx/', LINEA: 'https://lineascan.build/tx/', SCROLL: 'https://scrollscan.com/tx/', BLAST: 'https://blastscan.io/tx/',
  GNOSIS: 'https://gnosisscan.io/tx/', MANTLE: 'https://mantlescan.xyz/tx/', UNICHAIN: 'https://uniscan.xyz/tx/',
}
export const hopTxUrl = (chainName: string, hash: string) => {
  const base = TX_EXPLORER[chainName.trim().toUpperCase()]
  return base ? `${base}${hash}` : undefined
}
