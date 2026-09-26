import 'server-only'
import { createPublicClient, http } from 'viem'
import { base, baseSepolia, mainnet, sepolia } from 'viem/chains'
import { PAY_CHAINS, PayChain, usdcPaid } from './plans'

const clients = {
  base: createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com') }),
  eth: createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com') }),
  'base-sepolia': createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com') }),
  sepolia: createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') }),
}

/** Test mode: Pro is paid with free test USDC on test networks (for demos; no real money) */
export const paymentsTestMode = () => process.env.PAYMENTS_TESTNET === '1'

/** Ethereum blocks to wait before crediting (Base has no practical reorgs) */
const CONFIRMATIONS: Record<PayChain, bigint> = { base: 1n, eth: 3n, 'base-sepolia': 1n, sepolia: 1n }

export type UsdcCheck = { ok: true; usdc: number; paidAt: string } | { ok: false; error: string; retry?: boolean }

/** Checks on-chain that `hash` sent USDC from `from` to `payTo` */
export async function checkUsdcPayment(chain: PayChain, hash: `0x${string}`, from: string, payTo: string): Promise<UsdcCheck> {
  const client = clients[chain]
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null)
  if (!receipt) return { ok: false, error: `Transaction not found on ${PAY_CHAINS[chain].name} yet`, retry: true }
  if (receipt.status !== 'success') return { ok: false, error: 'That transaction failed' }
  const head = await client.getBlockNumber()
  if (head - receipt.blockNumber + 1n < CONFIRMATIONS[chain]) return { ok: false, error: 'Waiting for confirmations', retry: true }
  const usdc = usdcPaid(receipt.logs, PAY_CHAINS[chain].usdc, from, payTo)
  if (!usdc) return { ok: false, error: 'No USDC from your wallet to Ashiato in that transaction' }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  return { ok: true, usdc, paidAt: new Date(Number(block.timestamp) * 1000).toISOString() }
}
