import { Chain, EntityType } from './types'

export function nativeAsset(chain: Chain): string {
  return chain === 'btc' ? 'BTC' : 'ETH'
}

/** "USDT*" marks a look-alike token contract; show it plainly as fake */
export function assetName(asset: string): string {
  return asset.endsWith('*') ? `${asset.slice(0, -1)} (fake token)` : asset
}

export function fmtAmount(amount: number, asset: string, digits = 4): string {
  const name = assetName(asset)
  if (amount === 0) return `0 ${name}`
  const min = 10 ** -digits
  if (Math.abs(amount) < min) return `<${min} ${name}`
  const stable = /^(USDT|USDC|DAI|BUSD|TUSD|USDP|FDUSD|PYUSD)$/.test(asset)
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: stable ? 2 : digits })} ${name}`
}

export function fmtBalance(balance: number, chain: Chain): string {
  return fmtAmount(balance, nativeAsset(chain), chain === 'btc' ? 8 : 6)
}

export function fmtDate(ts: number): string {
  if (!ts) return 'pending'
  const d = new Date(ts * 1000)
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

export function explorerAddressUrl(address: string, chain: Chain): string {
  return chain === 'btc'
    ? `https://mempool.space/address/${address}`
    : `https://etherscan.io/address/${address}`
}

export function explorerTxUrl(txid: string, chain: Chain): string {
  return chain === 'btc' ? `https://mempool.space/tx/${txid}` : `https://etherscan.io/tx/${txid}`
}

/** Fiat value, or 0 when no price is known for the asset */
export function fiatValue(amount: number, asset: string, prices: Record<string, number>): number {
  const p = prices[asset] ?? (/^(USDT|USDC|DAI|BUSD|FDUSD|PYUSD)$/.test(asset) ? prices.USD : 0)
  return p ? amount * p : 0
}

/**
 * Per-entity colours shared by nodes, badges, legend and minimap.
 * Class names are written out in full so Tailwind's scanner keeps them.
 */
export const ENTITY_STYLE: Record<EntityType, { hex: string; label: string; border: string; badge: string; dot: string }> = {
  sanctioned: { hex: '#dc2626', label: 'Sanctioned (OFAC)', border: 'border-red-600', badge: 'bg-red-600/15 text-red-600', dot: 'bg-red-600' },
  scam:       { hex: '#ef4444', label: 'Scam / fraud', border: 'border-red-500', badge: 'bg-red-500/15 text-red-500', dot: 'bg-red-500' },
  hack:       { hex: '#f43f5e', label: 'Hack / exploit', border: 'border-rose-500', badge: 'bg-rose-500/15 text-rose-500', dot: 'bg-rose-500' },
  ransomware: { hex: '#e11d48', label: 'Ransomware', border: 'border-rose-600', badge: 'bg-rose-600/15 text-rose-600', dot: 'bg-rose-600' },
  illicit:    { hex: '#b91c1c', label: 'Terror / extremism', border: 'border-red-700', badge: 'bg-red-700/15 text-red-700', dot: 'bg-red-700' },
  darknet:    { hex: '#db2777', label: 'Darknet market', border: 'border-pink-600', badge: 'bg-pink-600/15 text-pink-600', dot: 'bg-pink-600' },
  mixer:      { hex: '#f97316', label: 'Mixer / tumbler', border: 'border-orange-500', badge: 'bg-orange-500/15 text-orange-500', dot: 'bg-orange-500' },
  coinjoin:   { hex: '#fb923c', label: 'CoinJoin', border: 'border-orange-400', badge: 'bg-orange-400/15 text-orange-400', dot: 'bg-orange-400' },
  exchange:   { hex: '#22c55e', label: 'Exchange', border: 'border-green-500', badge: 'bg-green-500/15 text-green-500', dot: 'bg-green-500' },
  deposit:    { hex: '#10b981', label: 'Exchange deposit addr', border: 'border-emerald-500', badge: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500' },
  gambling:   { hex: '#eab308', label: 'Gambling', border: 'border-yellow-500', badge: 'bg-yellow-500/15 text-yellow-500', dot: 'bg-yellow-500' },
  defi:       { hex: '#8b5cf6', label: 'DeFi protocol', border: 'border-violet-500', badge: 'bg-violet-500/15 text-violet-500', dot: 'bg-violet-500' },
  miner:      { hex: '#94a3b8', label: 'Miner', border: 'border-slate-400', badge: 'bg-slate-400/15 text-slate-400', dot: 'bg-slate-400' },
  service:    { hex: '#0ea5e9', label: 'Service', border: 'border-sky-500', badge: 'bg-sky-500/15 text-sky-500', dot: 'bg-sky-500' },
  wallet:     { hex: '#78716c', label: 'Known wallet', border: 'border-stone-500', badge: 'bg-stone-500/15 text-stone-500', dot: 'bg-stone-500' },
  unknown:    { hex: '#737373', label: 'Unknown wallet', border: 'border-neutral-500', badge: 'bg-neutral-500/15 text-neutral-500', dot: 'bg-neutral-500' },
}

export const RISKY_TYPES: EntityType[] = ['sanctioned', 'scam', 'hack', 'ransomware', 'illicit', 'darknet', 'mixer', 'coinjoin']
