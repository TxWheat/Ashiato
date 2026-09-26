#!/usr/bin/env node
// Builds data/labels/{btc,eth}.tsv.gz from open label sources:
//   - GraphSense TagPacks (MIT)   https://github.com/graphsense/graphsense-tagpacks
//   - OFAC SDN crypto addresses   https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (lists branch)
//   - eth-labels (MIT)            https://github.com/dawsbot/eth-labels (Etherscan-family public name tags)
//   - data/labels/curated.tsv     hand-maintained labels in this repo
//
// Usage:
//   git clone --depth 1 https://github.com/graphsense/graphsense-tagpacks.git /tmp/tagpacks
//   git clone --depth 1 -b lists https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses.git /tmp/ofac
//   git clone --depth 1 https://github.com/dawsbot/eth-labels.git /tmp/eth-labels
//   node scripts/build-labels.mjs --tagpacks /tmp/tagpacks --ofac /tmp/ofac --eth-labels /tmp/eth-labels [--with-miners] [--with-bitmex]
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
const ethLabelsDir = arg('--eth-labels')
const withMiners = args.includes('--with-miners')
const withBitmex = args.includes('--with-bitmex')
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'labels')

// Higher = wins when an address has several labels
const PRIORITY = [
  'wallet', 'miner', 'service', 'defi', 'bridge', 'gambling', 'exchange', 'deposit',
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

const labels = { btc: new Map(), eth: new Map(), tron: new Map() }
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
    // Addresses seen in USDT blacklist-related transactions: it includes the null
    // address and routers like MetaMask Swap, so it says nothing about who is a scammer
    if (base === 'usdt_blacklist.yaml') continue
    const src = sourceId(
      `GraphSense TagPack: ${pack.title ?? base}`,
      typeof pack.source === 'string' && pack.source.startsWith('http')
        ? pack.source
        : `https://github.com/graphsense/graphsense-tagpacks/blob/master/packs/${base}`,
      'MIT'
    )
    for (const t of pack.tags) {
      const cur = String(t.currency ?? pack.currency ?? '').toUpperCase()
      const chain = cur === 'BTC' ? 'btc' : cur === 'ETH' ? 'eth' : cur === 'TRX' ? 'tron' : null
      if (!chain || !t.address) continue
      const abuse = t.abuse ?? pack.abuse
      const category = t.category ?? pack.category
      let type = ABUSE[abuse] ?? CATEGORY[category] ?? (abuse ? 'scam' : null)
      if (!type) continue
      // Etherscan "wordcloud" packs were keyword-matched: their "market" is NFT marketplaces
      // (not darknet), and token contracts ("TORN Token (TORN)") or grants that merely
      // mention an exchange or mixer are not one
      const label = String(t.label ?? pack.label ?? '')
      if (base.startsWith('etherscan-wordcloud-') && (category === 'market' || /\([^()]+\)\s*$|gitcoin/i.test(label))) type = 'service'
      if ((type === 'mixer' || type === 'exchange') && /\btoken\b/i.test(label)) type = 'service'
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
  const files = {
    btc: ['sanctioned_addresses_XBT.txt'],
    eth: ['sanctioned_addresses_ETH.txt', 'sanctioned_addresses_USDT.txt', 'sanctioned_addresses_USDC.txt'],
    tron: ['sanctioned_addresses_TRX.txt', 'sanctioned_addresses_USDT.txt', 'sanctioned_addresses_USDC.txt'],
  }
  for (const [chain, names] of Object.entries(files)) {
    for (const name of names) {
      const p = path.join(ofacDir, name)
      if (!fs.existsSync(p)) continue
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const a = line.trim()
        if (!a) continue
        if (chain === 'eth' && !/^0x[0-9a-fA-F]{40}$/.test(a)) continue
        if (chain === 'tron' && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) continue
        add(chain, a, 'OFAC sanctioned address', 'sanctioned', src)
      }
    }
  }
}

// ── eth-labels (Etherscan-family name tags) ───────────────────────────────
// Categories that describe people or history rather than who controls funds
const ETH_LABELS_SKIP = new Set([
  'take-action', 'genesis-address', 'blocked', 'airdrop-hunter', 'sybil-delegate', 'delegate', 'nonprofit',
  'charity', 'endaoment', 'buidlguidl-builders', 'proposer-fee-recipient', 'avs-operator', 'maker-vault-owner',
  'parity-bug', 'token-sale', 'old-contract', 'deprecated', 'fraud-proof', 'binance-charity',
])
const CEX = new Set([
  'exchange', 'bitget', 'deribit', 'bilaxy', 'coinbase', 'bitfinex', 'kraken', 'bithumb', 'kucoin', 'okx', 'crypto-com',
  'gate', 'gate-io', 'mexc', 'gemini', 'upbit', 'bitstamp', 'binance', 'blofin-exchange', 'huobi', 'htx', 'bybit',
])
function ethLabelType(slug, name) {
  // Sanctions come only from the live OFAC list: eth-labels' OFAC tags are stale
  // (e.g. Tornado Cash, delisted in 2025)
  if (/ofac/.test(slug)) return /tornado/i.test(name) ? 'mixer' : null
  if (slug === 'phish-hack' || slug === 'scam' || /fake_phishing/i.test(name)) return 'scam'
  if (slug === 'heist' || /exploit$/.test(slug)) return 'hack'
  if (/tornado|mixer/.test(slug)) return /\btoken\b/i.test(name) ? 'service' : 'mixer'
  if (slug === 'gambling') return 'gambling'
  if (CEX.has(slug)) return /\bdep(osit)?\b:?/i.test(name) && !/funder/i.test(name) ? 'deposit' : 'exchange'
  return 'service'
}
if (ethLabelsDir) {
  const src = sourceId('eth-labels (Etherscan public name tags)', 'https://github.com/dawsbot/eth-labels', 'MIT')
  const text = fs.readFileSync(path.join(ethLabelsDir, 'data', 'csv', 'accounts.csv'), 'utf8')
  const unq = v => v.replace(/^"|"$/g, '').replace(/""/g, '"')
  const rows = text.split('\n').slice(1).filter(Boolean).map(line => {
    // address,chainId,label,nameTag (nameTag may contain commas)
    const m = line.match(/^("[^"]*"|[^,]*),("[^"]*"|[^,]*),("[^"]*"|[^,]*),(.*)$/)
    return m ? { address: unq(m[1]).toLowerCase(), chain: unq(m[2]), slug: unq(m[3]), tag: unq(m[4]).trim() } : null
  }).filter(Boolean)
  const pretty = slug => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const seen = new Set()
  // Ethereum mainnet first. An ordinary wallet is the same key on every EVM chain, so
  // exchange / abuse tags from other chains also apply (e.g. "MEXC 16" is only tagged on
  // Avalanche and World Chain); protocol tags from other chains may be different contracts.
  for (const pass of ['1', 'other']) {
    for (const r of rows) {
      if ((pass === '1') !== (r.chain === '1') || ETH_LABELS_SKIP.has(r.slug)) continue
      if (!/^0x[0-9a-f]{40}$/.test(r.address)) continue
      // "Bitget Dep: 0x3b41…" → "Bitget deposit address"; "MEV Bot: 0x19f...7e6" → "MEV Bot"
      const tag = (r.tag && r.tag !== 'null' ? r.tag : '')
        .replace(/\s+Dep:\s*0x[0-9a-f.…]+$/i, ' deposit address')
        .replace(/:\s*0x[0-9a-f.…]+$/i, '')
      const type = ethLabelType(r.slug, tag)
      if (!type) continue
      if (pass === 'other' && (type === 'service' || seen.has(r.address))) continue
      const name = tag || `${pretty(r.slug)}${type === 'exchange' ? ' (exchange)' : ''}`
      seen.add(r.address)
      add('eth', r.address, name, type, src)
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

for (const chain of ['btc', 'eth', 'tron']) {
  const rows = [...labels[chain]].sort(([a], [b]) => (a < b ? -1 : 1))
  const out = rows.map(([a, l]) => `${a}\t${l.name}\t${l.type}\t${l.src}`).join('\n') + '\n'
  fs.writeFileSync(path.join(outDir, `${chain}.tsv.gz`), zlib.gzipSync(out, { level: 9 }))
  const counts = {}
  for (const [, l] of rows) counts[l.type] = (counts[l.type] ?? 0) + 1
  console.log(chain, rows.length, counts)
}
fs.writeFileSync(path.join(outDir, 'sources.json'), JSON.stringify(sources, null, 1) + '\n')
console.log('sources', sources.length)
