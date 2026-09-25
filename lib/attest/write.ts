import { decodeEventLog, parseAbi, zeroAddress, zeroHash, type Account, type PublicClient, type WalletClient } from 'viem'
import { ATTEST_CHAIN, SCHEMA_UID } from './config'
import { checkLabel, encodeLabel, encodeReport, encodeVote, LabelInput, ReportInput, VoteInput } from './encode'

// Writing attestations from the browser with the connected wallet (wagmi's
// useWalletClient / usePublicClient give the two clients). Each call is one transaction.

export const EAS_ABI = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct AttestationRequest { bytes32 schema; AttestationRequestData data; }',
  'struct RevocationRequestData { bytes32 uid; uint256 value; }',
  'struct RevocationRequest { bytes32 schema; RevocationRequestData data; }',
  'function attest(AttestationRequest request) payable returns (bytes32)',
  'function revoke(RevocationRequest request) payable',
  'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
])

/**
 * Wallets report their network as a number, hex ("0xaa36a7") or, for Reown's email
 * wallets, CAIP-2 text ("eip155:11155111"). viem's own check only handles hex, so we
 * read and parse it ourselves.
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

export const SEPOLIA_FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia'

/** Wallet errors people can act on */
function friendly(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/insufficient funds|exceeds balance|gas required exceeds/i.test(msg)) {
    return new Error(`Your wallet needs a little Sepolia test ETH to pay the network fee. Get some free: ${SEPOLIA_FAUCET}`)
  }
  if (/user rejected|denied|cancel/i.test(msg)) return new Error('Cancelled in your wallet')
  return e instanceof Error ? e : new Error(msg)
}

export class WrongNetworkError extends Error {
  constructor() {
    super(`Switch your wallet to ${ATTEST_CHAIN.name} to add or vote on labels`)
  }
}

async function send(wallet: WalletClient, pub: PublicClient, schema: `0x${string}`, data: `0x${string}`, recipient: `0x${string}` = zeroAddress, refUID: `0x${string}` = zeroHash) {
  if (!wallet.account) throw new Error('Connect a wallet first')
  if ((await walletChainId(wallet)) !== ATTEST_CHAIN.id) throw new WrongNetworkError()
  // An empty wallet can't pay the fee: say so plainly instead of a gas-estimate error
  if ((await pub.getBalance({ address: wallet.account.address })) === 0n) {
    throw new Error(`Your wallet has no Sepolia test ETH for the network fee. Get some free (it takes a minute): ${SEPOLIA_FAUCET}`)
  }
  const hash = await wallet.writeContract({
    address: ATTEST_CHAIN.eas,
    abi: EAS_ABI,
    functionName: 'attest',
    args: [{ schema, data: { recipient, expirationTime: 0n, revocable: true, refUID, data, value: 0n } }],
    account: wallet.account as Account,
    // Network already checked above; null skips viem's own check, which can't read CAIP-2 ids
    chain: null,
  }).catch(e => { throw friendly(e) })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The attestation transaction failed')
  return { hash, uid: uidFromLogs(receipt.logs) }
}

/** The new attestation's UID, from the Attested event */
export function uidFromLogs(logs: { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] }[]): `0x${string}` | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== ATTEST_CHAIN.eas.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: EAS_ABI, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] })
      if (ev.eventName === 'Attested') return ev.args.uid
    } catch { /* another event */ }
  }
  return undefined
}

export async function attestLabel(wallet: WalletClient, pub: PublicClient, label: LabelInput) {
  const errs = checkLabel(label)
  if (errs.length) throw new Error(errs.join('. '))
  // Ethereum subjects are also the attestation's recipient, so explorers index them
  const recipient = label.chain === 'eth' ? (label.subject.toLowerCase() as `0x${string}`) : zeroAddress
  return send(wallet, pub, SCHEMA_UID.label, encodeLabel(label), recipient)
}

/** Your latest vote on a label replaces your earlier one */
export async function voteOnLabel(wallet: WalletClient, pub: PublicClient, labelUid: `0x${string}`, vote: VoteInput) {
  if (vote.trust < 0 && !vote.reason.trim()) throw new Error('Say why you dispute this label')
  return send(wallet, pub, SCHEMA_UID.vote, encodeVote(vote), zeroAddress, labelUid)
}

export async function attestReport(wallet: WalletClient, pub: PublicClient, report: ReportInput) {
  return send(wallet, pub, SCHEMA_UID.report, encodeReport(report))
}

/** Withdraw your own label (or vote) */
export async function revokeAttestation(wallet: WalletClient, pub: PublicClient, schema: `0x${string}`, uid: `0x${string}`) {
  if (!wallet.account) throw new Error('Connect a wallet first')
  if ((await walletChainId(wallet)) !== ATTEST_CHAIN.id) throw new WrongNetworkError()
  const hash = await wallet.writeContract({
    address: ATTEST_CHAIN.eas,
    abi: EAS_ABI,
    functionName: 'revoke',
    args: [{ schema, data: { uid, value: 0n } }],
    account: wallet.account as Account,
    chain: null,
  }).catch(e => { throw friendly(e) })
  await pub.waitForTransactionReceipt({ hash })
  return { hash }
}
