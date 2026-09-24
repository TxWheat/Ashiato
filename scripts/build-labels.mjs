#!/usr/bin/env node
// Builds data/labels/{btc,eth}.tsv.gz from open label sources:
//   - GraphSense TagPacks (MIT)   https://github.com/graphsense/graphsense-tagpacks
//   - OFAC SDN crypto addresses   https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (lists branch)
//   - data/labels/curated.tsv     hand-maintained labels in this repo
//
// Usage:
//   git clone --depth 1 https://github.com/graphsense/graphsense-tagpacks.git /tmp/tagpacks
//   git clone --depth 1 -b lists https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses.git /tmp/ofac
//   node scripts/build-labels.mjs --tagpacks /tmp/tagpacks --ofac /tmp/ofac [--with-miners] [--with-bitmex]
//
// BitMEX deposit addresses (336k) are skipped by default: they all start with "3BMEX"
// and lib/labels.ts matches that prefix instead. Miner payout addresses are skipped
// by default because they rarely matter in fraud cases.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import * as yaml from 'js-yaml'

const args = process.argv.slice(2)
const arg = name => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const tagpacksDir = arg('--tagpacks')
const ofacDir = arg('--ofac')
const withMiners = args.includes('--with-miners')
const withBitmex = args.includes('--with-bitmex')
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'labels')

// Higher = wins when an address has several labels
const PRIORITY = [
  'wallet', 'miner', 'service', 'defi', 'gambling', 'exchange', 'deposit',
  'coinjoin', 'mixer', 'darknet', 'scam', 'hack', 'ransomware', 'illicit', 'sanctioned',
]

const ABUSE = {
  sanction: 'sanctioned',
  ransomware: 'ransomware',
  sextortion: 'scam',
  scam: 'scam',
  phishing: 'scam',
  ponzi_scheme: 'scam',
  pyramid_scheme: 'scam',
  investment_fraud: 'scam',
  service_hack: 'hack',
  terrorism: 'illicit',
  extremism: 'illicit',
}

const CATEGORY = {
  exchange: 'exchange',
  coinjoin: 'coinjoin',
  mixing_service: 'mixer',
  sanction: 'sanctioned',
  black_list: 'scam',
  gambling: 'gambling',
  defi: 'defi',
  defi_lending: 'defi',
  defi_dex: 'defi',
  market: 'darknet',
  miner: 'miner',
  wallet_service: 'service',
  service: 'service',
  organization: 'service',
  user: 'wallet',
}

function normalise(address, chain) {
  const a = String(address).trim()
  if (chain === 'eth') return a.toLowerCase()
  // bech32 is case-insensitive; base58 is case-sensitive
  return /^bc1/i.test(a) ? a.toLowerCase() : a
}

function clean(s) {
  return String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim()
}

const sources = [] // { title, url, license }
const sourceIdx = new Map()
function sourceId(title, url, license) {
  const key = `${title}|${url}`
  if (!sourceIdx.has(key)) {
    sourceIdx.set(key, sources.length)
    sources.push({ title, url, license })
  }
  return sourceIdx.get(key)
}

const labels = { btc: new Map(), eth: new Map() }
function add(chain, address, name, type, src) {
  if (!type || !name) return
  const addr = normalise(address, chain)
  const existing = labels[chain].get(addr)
  if (existing && PRIORITY.indexOf(existing.type) >= PRIORITY.indexOf(type)) return
  labels[chain].set(addr, { name: clean(name).slice(0, 80), type, src })
}

// ── Curated ────────────────────────────────────────────────────────────────
const curatedPath = path.join(outDir, 'curated.tsv')
const curatedSrc = sourceId('Curated (this repo)', 'data/labels/curated.tsv', 'MIT')
const curated = []
for (const line of fs.readFileSync(curatedPath, 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue
  const [chain, address, name, type] = line.split('\t')
  curated.push({ chain, address, name, type })
}

// ── GraphSense TagPacks ────────────────────────────────────────────────────
if (tagpacksDir) {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.yaml') ? [path.join(dir, d.name)] : [])
  for (const file of walk(path.join(tagpacksDir, 'packs'))) {
    let pack
    try { pack = yaml.load(fs.readFileSync(file, 'utf8')) } catch { continue }
    if (!pack?.tags) continue
    const base = path.basename(file)
    if (!withBitmex && base.startsWith('exchange-wallets-bitmex')) continue
    const src = sourceId(
      `GraphSense TagPack: ${pack.title ?? base}`,
      typeof pack.source === 'string' && pack.source.startsWith('http')
        ? pack.source
        : `https://github.com/graphsense/graphsense-tagpacks/blob/master/packs/${base}`,
      'MIT'
    )
    for (const t of pack.tags) {
      const cur = String(t.currency ?? pack.currency ?? '').toUpperCase()
      const chain = cur === 'BTC' ? 'btc' : cur === 'ETH' ? 'eth' : null
      if (!chain || !t.address) continue
      const abuse = t.abuse ?? pack.abuse
      const category = t.category ?? pack.category
      const type = ABUSE[abuse] ?? CATEGORY[category] ?? (abuse ? 'scam' : null)
      if (!type) continue
      if (type === 'miner' && !withMiners) continue
      add(chain, t.address, t.label ?? pack.label ?? pack.title, type, src)
    }
  }
}

// ── OFAC SDN ───────────────────────────────────────────────────────────────
if (ofacDir) {
  const src = sourceId(
    'US Treasury OFAC SDN list (via 0xB10C mirror)',
    'https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses',
    'Public domain (US Gov) / MIT tooling'
  )
  const files = { btc: ['sanctioned_addresses_XBT.txt'], eth: ['sanctioned_addresses_ETH.txt', 'sanctioned_addresses_USDT.txt', 'sanctioned_addresses_USDC.txt'] }
  for (const [chain, names] of Object.entries(files)) {
    for (const name of names) {
      const p = path.join(ofacDir, name)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const a = line.trim()
        if (!a) continue
        if (chain === 'eth' && !/^0x[0-9a-fA-F]{40}$/.test(a)) continue
        add(chain, a, 'OFAC sanctioned address', 'sanctioned', src)
      }
    }
  }
}

// Curated last so it wins ties at equal priority but never downgrades a sanction
for (const c of curated) {
  const addr = normalise(c.address, c.chain)
  const ex = labels[c.chain]?.get(addr)
  if (ex && PRIORITY.indexOf(ex.type) > PRIORITY.indexOf(c.type)) continue
  labels[c.chain]?.set(addr, { name: c.name, type: c.type, src: curatedSrc })
}

for (const chain of ['btc', 'eth']) {
  const rows = [...labels[chain]].sort(([a], [b]) => (a < b ? -1 : 1))
  const out = rows.map(([a, l]) => `${a}\t${l.name}\t${l.type}\t${l.src}`).join('\n') + '\n'
  fs.writeFileSync(path.join(outDir, `${chain}.tsv.gz`), zlib.gzipSync(out, { level: 9 }))
  const counts = {}
  for (const [, l] of rows) counts[l.type] = (counts[l.type] ?? 0) + 1
  console.log(chain, rows.length, counts)
}
fs.writeFileSync(path.join(outDir, 'sources.json'), JSON.stringify(sources, null, 1) + '\n')
console.log('sources', sources.length)
