#!/usr/bin/env node
// Builds data/labels/scam-mew.tsv from MyEtherWallet's darklist (MIT):
//   curl -sL https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json -o /tmp/darklist.json
//   node scripts/build-scam-lists.mjs /tmp/darklist.json
//
// ScamSniffer's list is GPL-3.0, so it isn't copied into this repo: the server
// downloads it at runtime (lib/scam-lists.ts).

import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2]
if (!input) {
  console.error('Usage: node scripts/build-scam-lists.mjs <addresses-darklist.json>')
  process.exit(1)
}
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'labels', 'scam-mew.tsv')
const clean = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim()

const rows = new Map()
for (const r of JSON.parse(fs.readFileSync(input, 'utf8'))) {
  const address = String(r.address ?? '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) continue
  const why = clean(r.comment).slice(0, 60)
  rows.set(address, `Reported scam${why ? `: ${why}` : ''}`)
}
const lines = [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([a, name]) => `eth\t${a}\t${name}\tscam`)
fs.writeFileSync(out, `# chain\taddress\tname\ttype  (MyEtherWallet ethereum-lists darklist, MIT)\n${lines.join('\n')}\n`)
console.log(`${lines.length} addresses -> ${out}`)
