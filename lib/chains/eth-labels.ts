// Server-only: labels for ETH addresses that aren't in the offline label files,
// fetched from Etherscan for addresses loaded onto the graph.
import 'server-only'
import { EntityLabel, EntityType } from '../types'
import { fetchJson } from '../http'
import { etherscanUrl, etherscanRateLimited } from './eth'

/** Map a name tag / label list onto our entity types. Order matters: most specific first. */
export function classifyTag(text: string): EntityType {
  const t = text.toLowerCase()
  if (/sanction|ofac/.test(t)) return 'sanctioned'
  if (/phish|scam|fake_?phishing|drainer/.test(t)) return 'scam'
  if (/exploit|hack|heist/.test(t)) return 'hack'
  if (/mixer|tornado|privacy ?pool|railgun|blender|sinbad|wasabi|coinjoin/.test(t)) return 'mixer'
  if (/gambl|casino|betting/.test(t)) return 'gambling'
  if (/exchange|binance|coinbase|kraken|okx|bybit|kucoin|bitfinex|gemini|huobi|htx|gate\.io|bitstamp|crypto\.com|upbit|bithumb|mexc|bitget|poloniex|hitbtc|-hot\b|hot wallet|cold wallet/.test(t)) {
    return /deposit address|: deposit\b/.test(t) && !/privacy/.test(t) ? 'deposit' : 'exchange'
  }
  return 'service'
}

interface NametagRow {
  nametag?: string
  labels?: string[]
  url?: string
}

/**
 * Public name tags (e.g. "Privacy Pools: Deposit" + "Mixer") come from Etherscan's
 * nametag API, which is only on the Pro Plus plan. We try it once; if the key
 * can't use it we stop asking for the rest of the process.
 */
let nametagsAvailable = process.env.ETHERSCAN_NAMETAGS !== '0'

async function nametag(address: string): Promise<EntityLabel | undefined> {
  if (!nametagsAvailable) return undefined
  const body = await fetchJson<{ status: string; message: string; result: NametagRow[] | NametagRow | string }>(
    etherscanUrl({ module: 'nametag', action: 'getaddresstag', address }), 86400, 3, etherscanRateLimited
  )
  if (body.status !== '1') {
    // Plan / access errors come back as status 0 with an explanation in `result`
    if (typeof body.result === 'string' && /pro|upgrade|plan|not (available|supported|authori[sz]ed)|invalid|access/i.test(body.result)) {
      nametagsAvailable = false
    }
    return undefined
  }
  const row = Array.isArray(body.result) ? body.result[0] : typeof body.result === 'object' ? body.result : undefined
  const name = row?.nametag?.trim()
  if (!name) return undefined
  const labels = row?.labels ?? []
  return {
    name,
    type: classifyTag(`${name} ${labels.join(' ')}`),
    source: labels.length ? `Etherscan name tag (${labels.join(', ')})` : 'Etherscan name tag',
    sourceUrl: `https://etherscan.io/address/${address}`,
  }
}

interface SourceRow {
  ContractName?: string
  Proxy?: string
  Implementation?: string
}

const GENERIC_PROXY = /^(ERC1967Proxy|TransparentUpgradeableProxy|AdminUpgradeabilityProxy|InitializableImmutableAdminUpgradeabilityProxy|OwnedUpgradeabilityProxy|UUPSProxy|BeaconProxy|Proxy|GnosisSafeProxy|SafeProxy)$/i

async function sourceRow(address: string): Promise<SourceRow | undefined> {
  const body = await fetchJson<{ status: string; result: SourceRow[] | string }>(
    etherscanUrl({ module: 'contract', action: 'getsourcecode', address }), 86400, 3, etherscanRateLimited
  )
  return body.status === '1' && Array.isArray(body.result) ? body.result[0] : undefined
}

/**
 * Free fallback: a verified contract's own name. For a proxy with a generic name
 * (e.g. ERC1967Proxy) we use its implementation's name instead. The deployer
 * chooses these names, so they're marked as inferred.
 */
async function verifiedContract(address: string): Promise<EntityLabel | undefined> {
  const row = await sourceRow(address)
  let name = row?.ContractName?.trim()
  if (!row || !name) return undefined // not a contract, or not verified
  if (row.Proxy === '1' && row.Implementation && GENERIC_PROXY.test(name)) {
    const impl = await sourceRow(row.Implementation.toLowerCase()).catch(() => undefined)
    name = impl?.ContractName?.trim() || name
  }
  if (/^(GnosisSafe|Safe)(L2)?$/i.test(name) || /SafeProxy/i.test(row.ContractName ?? '')) name = 'Safe multisig wallet'
  const type = classifyTag(name.replace(/([a-z])([A-Z])/g, '$1 $2'))
  return {
    name: `${name} (verified contract)`,
    type,
    source: 'Etherscan verified contract name (set by the deployer)',
    sourceUrl: `https://etherscan.io/address/${address}#code`,
    inferredBy: 'contract-name',
    confidence: type === 'service' ? 0.5 : 0.7,
  }
}

/** Best Etherscan label for an address: public name tag, else verified contract name */
export async function etherscanLabel(address: string): Promise<EntityLabel | undefined> {
  try {
    return (await nametag(address)) ?? (await verifiedContract(address))
  } catch {
    return undefined // labels are best-effort; never fail a trace over them
  }
}
