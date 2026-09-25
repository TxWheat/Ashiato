#!/usr/bin/env node
// Registers Ashiato's three EAS schemas (label, vote, report) on Sepolia. Run once;
// schemas already registered are skipped. UIDs are deterministic, so lib/attest/config.ts
// knows them without this script.
//
//   PRIVATE_KEY=0x… [SEPOLIA_RPC_URL=https://…] node scripts/register-schemas.mjs
//
// Use a throwaway test wallet with a little Sepolia ETH. Never commit the key.

import { createPublicClient, createWalletClient, encodePacked, http, keccak256, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const REGISTRY = '0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0'
const SCHEMAS = {
  label: 'string chain,string subject,string category,string name,string evidence,uint8 confidence',
  vote: 'int8 trust,string reason',
  report: 'bytes32 reportHash,string chain,string subject,string summary',
}
const abi = parseAbi([
  'function register(string schema, address resolver, bool revocable) returns (bytes32)',
  'function getSchema(bytes32 uid) view returns ((bytes32 uid, address resolver, bool revocable, string schema))',
])

const key = process.env.PRIVATE_KEY
if (!key) {
  console.error('Set PRIVATE_KEY (a test wallet with Sepolia ETH)')
  process.exit(1)
}
const transport = http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com')
const account = privateKeyToAccount(key)
const pub = createPublicClient({ chain: sepolia, transport })
const wallet = createWalletClient({ chain: sepolia, transport, account })

for (const [name, schema] of Object.entries(SCHEMAS)) {
  const uid = keccak256(encodePacked(['string', 'address', 'bool'], [schema, zeroAddress, true]))
  const existing = await pub.readContract({ address: REGISTRY, abi, functionName: 'getSchema', args: [uid] })
  if (existing.uid !== '0x' + '0'.repeat(64)) {
    console.log(`${name}: already registered ${uid}`)
    continue
  }
  const hash = await wallet.writeContract({ address: REGISTRY, abi, functionName: 'register', args: [schema, zeroAddress, true] })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`${name}: registered ${uid} (tx ${hash})`)
}
console.log(`View: https://sepolia.easscan.org/schema/view/<uid>`)
