// Server-only: loads the gzipped label files built by scripts/build-labels.mjs.
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Chain, EntityLabel, EntityType } from './types'
import { normaliseAddress } from './detect-chain'

interface Source { title: string; url: string; license: string }

const DIR = path.join(process.cwd(), 'data', 'labels')

let cache: { btc: Map<string, EntityLabel>; eth: Map<string, EntityLabel> } | null = null

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
  cache = { btc: read('btc'), eth: read('eth') }
  return cache
}

export function getLabel(address: string, chain: Chain): EntityLabel | undefined {
  const addr = normaliseAddress(address, chain)
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
  for (const m of [c.btc, c.eth]) for (const l of m.values()) if (l.type === 'sanctioned') sanctioned++
  return { btc: c.btc.size, eth: c.eth.size, sanctioned }
}
