import type { WalletClient } from 'viem'

/**
 * Wallets report their network as a number, hex ("0x2105") or, for Reown's email wallets,
 * CAIP-2 text ("eip155:8453"). viem's own check only handles hex, so we read and parse it.
 */
export function parseChainId(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v !== 'string') return undefined
  const s = v.replace(/^eip155:/, '')
  const n = /^0x/i.test(s) ? parseInt(s, 16) : parseInt(s, 10)
  return Number.isFinite(n) ? n : undefined
}

export async function walletChainId(wallet: WalletClient): Promise<number | undefined> {
  try {
    return parseChainId(await wallet.request({ method: 'eth_chainId' }))
  } catch {
    return wallet.chain?.id
  }
}
