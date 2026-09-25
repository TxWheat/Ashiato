// Server-only: loads the gzipped label files built by scripts/build-labels.mjs.
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Chain, EntityLabel, EntityType } from './types'
import { normaliseAddress } from './detect-chain'

interface Source { title: string; url: string; license: string }

const DIR = path.join(process.cwd(), 'data', 'labels')

let cache: Record<Chain, Map<string, EntityLabel>> | null = null

function load() {
  if (cache) return cache
  const sources: Source[] = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'))
  const read = (chain: Chain) => {
    const map = new Map<string, EntityLabel>()
    const file = path.join(DIR, `${chain}.tsv.gz`)
    if (!fs.existsSync(file)) return map
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line) continue
      const [address, name, type, src] = line.split('\t')
      const s = sources[Number(src)]
      map.set(address, { name, type: type as EntityType, source: s?.title, sourceUrl: s?.url })
    }
    return map
  }
  cache = { btc: read('btc'), eth: read('eth'), tron: read('tron') }
  return cache
}

// Protocol addresses that public datasets mislabel (e.g. the zero address tagged as
// a scam because blacklisted tokens were minted from it) or miss entirely
const SPECIAL: Record<string, EntityLabel> = {
  '0x0000000000000000000000000000000000000000': { name: 'Null address (token mint / burn)', type: 'service', source: 'Ethereum convention' },
  '0x000000000000000000000000000000000000dead': { name: 'Burn address', type: 'service', source: 'Ethereum convention' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'Tether: USDT contract', type: 'service', source: 'Token contract' },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'Circle: USDC contract', type: 'service', source: 'Token contract' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'Maker: DAI contract', type: 'service', source: 'Token contract' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { name: 'WETH contract', type: 'service', source: 'Token contract' },
  // Cross-chain swap router (Bridgers docs: same address on ETH, BSC, Polygon and other EVM chains)
  '0xc1d13492285eb664951e201bf7c80c7c6318a1b5': { name: 'Bridgers: cross-chain swap router', type: 'service', source: 'Bridgers documentation', sourceUrl: 'https://docs-bridgers-en.bridgers.xyz/' },
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { name: 'WBTC contract', type: 'service', source: 'Token contract' },
  // Mixers missing from the public datasets (from Etherscan public name tags)
  '0x6818809eefce719e480a7526d76bd3e561526b46': { name: 'Privacy Pools: Deposit', type: 'mixer', source: 'Etherscan public name tag', sourceUrl: 'https://etherscan.io/address/0x6818809eefce719e480a7526d76bd3e561526b46' },
}

// Tron token contracts
const SPECIAL_TRON: Record<string, EntityLabel> = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { name: 'Tether: USDT (TRC-20) contract', type: 'service', source: 'Token contract' },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { name: 'Circle: USDC (TRC-20) contract', type: 'service', source: 'Token contract' },
  T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb: { name: 'Tron black-hole address (burn)', type: 'service', source: 'Tron convention' },
}

export function getLabel(address: string, chain: Chain): EntityLabel | undefined {
  const addr = normaliseAddress(address, chain)
  if (chain === 'eth' && SPECIAL[addr]) return SPECIAL[addr]
  if (chain === 'tron' && SPECIAL_TRON[addr]) return SPECIAL_TRON[addr]
  const hit = load()[chain].get(addr)
  if (hit) return hit
  // BitMEX gives every customer a vanity deposit address starting with 3BMEX
  if (chain === 'btc' && addr.startsWith('3BMEX')) {
    return {
      name: 'BitMEX deposit address',
      type: 'deposit',
      source: 'BitMEX vanity prefix (3BMEX…)',
      sourceUrl: 'https://github.com/graphsense/graphsense-tagpacks',
    }
  }
  return undefined
}

export function labelStats() {
  const c = load()
  let sanctioned = 0
  for (const m of [c.btc, c.eth, c.tron]) for (const l of m.values()) if (l.type === 'sanctioned') sanctioned++
  return { btc: c.btc.size, eth: c.eth.size, tron: c.tron.size, sanctioned }
}
