import { Chain } from '../types'

// Cross-chain swaps and bridges: money leaves one chain and arrives on another in a
// separate transaction. Services that expose their order records let us link the two.

export interface CrossChainHop {
  service: 'Bridgers'
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
  /** Unix seconds */
  time?: number
}

/** Names that mark an address as a cross-chain swap service we can look up */
export const BRIDGE_NAME = /bridgers|swft|omnibridge|allchain ?bridge/i

const CHAIN_ALIASES: Record<string, Chain> = {
  ETH: 'eth', ETHEREUM: 'eth', ERC20: 'eth',
  TRX: 'tron', TRON: 'tron', TRC20: 'tron',
  BTC: 'btc', BITCOIN: 'btc',
}
export const toOurChain = (name: string): Chain | undefined => CHAIN_ALIASES[name.trim().toUpperCase()]

const CHAIN_DISPLAY: Record<string, string> = {
  ETH: 'Ethereum', TRX: 'Tron', TRON: 'Tron', BTC: 'Bitcoin', BSC: 'BNB Chain', POLYGON: 'Polygon', MATIC: 'Polygon',
  ARBITRUM: 'Arbitrum', ARB: 'Arbitrum', OPTIMISM: 'Optimism', OP: 'Optimism', BASE: 'Base', AVAX: 'Avalanche', SOL: 'Solana', SOLANA: 'Solana',
}
export const chainDisplay = (name: string) => CHAIN_DISPLAY[name.trim().toUpperCase()] ?? name

const TX_EXPLORER: Record<string, string> = {
  ETH: 'https://etherscan.io/tx/', TRX: 'https://tronscan.org/#/transaction/', TRON: 'https://tronscan.org/#/transaction/',
  BTC: 'https://mempool.space/tx/', BSC: 'https://bscscan.com/tx/', POLYGON: 'https://polygonscan.com/tx/', MATIC: 'https://polygonscan.com/tx/',
  ARBITRUM: 'https://arbiscan.io/tx/', ARB: 'https://arbiscan.io/tx/', OPTIMISM: 'https://optimistic.etherscan.io/tx/', OP: 'https://optimistic.etherscan.io/tx/',
  BASE: 'https://basescan.org/tx/', AVAX: 'https://snowtrace.io/tx/', SOL: 'https://solscan.io/tx/', SOLANA: 'https://solscan.io/tx/',
}
export const hopTxUrl = (chainName: string, hash: string) => {
  const base = TX_EXPLORER[chainName.trim().toUpperCase()]
  return base ? `${base}${hash}` : undefined
}
