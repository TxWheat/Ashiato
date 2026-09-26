import type { Chain } from './types'

// Ethereum-style networks. They share address and transaction formats and one Etherscan
// V2 API (switched by chainid), so one set of code traces them all. Ethereum is free;
// the others are Ashiato Pro.

export const EVM = {
  eth: { id: 1, name: 'Ethereum', short: 'ETH', native: 'ETH', explorer: 'https://etherscan.io' },
  base: { id: 8453, name: 'Base', short: 'BASE', native: 'ETH', explorer: 'https://basescan.org' },
  arbitrum: { id: 42161, name: 'Arbitrum', short: 'ARB', native: 'ETH', explorer: 'https://arbiscan.io' },
  optimism: { id: 10, name: 'Optimism', short: 'OP', native: 'ETH', explorer: 'https://optimistic.etherscan.io' },
  bsc: { id: 56, name: 'BNB Chain', short: 'BSC', native: 'BNB', explorer: 'https://bscscan.com' },
  polygon: { id: 137, name: 'Polygon', short: 'POL', native: 'POL', explorer: 'https://polygonscan.com' },
} as const
export type EvmChain = keyof typeof EVM

export const EVM_CHAINS = Object.keys(EVM) as EvmChain[]
export const CHAINS: Chain[] = ['btc', 'tron', ...EVM_CHAINS]

export const isEvm = (c: string | null | undefined): c is EvmChain => !!c && c in EVM
export const isChain = (c: string | null | undefined): c is Chain => c === 'btc' || c === 'tron' || isEvm(c)
/** Networks beyond Bitcoin, Ethereum and Tron are part of Pro */
export const isProChain = (c: Chain) => isEvm(c) && c !== 'eth'

/** The network's native coin (ETH, BNB, POL) */
export const nativeAsset = (c: Chain) => (isEvm(c) ? EVM[c].native : c === 'btc' ? 'BTC' : 'TRX')

export const CHAIN_NAME: Record<Chain, string> = {
  btc: 'Bitcoin', tron: 'Tron',
  ...Object.fromEntries(EVM_CHAINS.map(c => [c, EVM[c].name])) as Record<EvmChain, string>,
}
