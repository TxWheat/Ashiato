import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, recoverTypedDataAddress } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { currentUser } from '@/lib/auth/session'
import { StoreNotConfigured } from '@/lib/supabase'
import { cleanSigned, Signed, typedData, uidOf, verifySigned } from '@/lib/attest/signed'
import { countSince, getSigned, insertSigned, revokeSigned } from '@/lib/attest/store'

// Signed community labels, votes and withdrawals. The wallet signs (free, no transaction);
// the server checks the signature and stores it. GET ?uid= returns the signed record so
// anyone can check it themselves.

const DAILY_LIMIT = 200
// The networks the app's wallets connect to. A smart-contract wallet's signature is only
// valid on the network it signed on, so each is tried
const clients = [
  createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com') }),
  createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com') }),
]

/** Ordinary wallets are checked offline; smart-contract wallets (email sign-ins) over RPC */
async function signedBy(s: Signed): Promise<boolean> {
  if (await verifySigned(s)) return true
  const args = { address: s.message.attester, signature: s.signature, ...typedData(s) } as unknown as Parameters<(typeof clients)[number]['verifyTypedData']>[0]
  const results = await Promise.all(clients.map(c => c.verifyTypedData(args).catch(() => false)))
  return results.some(Boolean)
}

/** Who an ordinary-wallet signature came from, to explain a mismatch */
async function recovered(s: Signed): Promise<string | null> {
  return recoverTypedDataAddress({ signature: s.signature, ...typedData(s) } as Parameters<typeof recoverTypedDataAddress>[0])
    .then(a => a.toLowerCase()).catch(() => null)
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return fail('Sign in to add or vote on labels', 401)
  const s = cleanSigned(await req.json().catch(() => null))
  if (typeof s === 'string') return fail(s, 400)
  if (s.message.attester !== user) return fail('Sign with the wallet you signed in with', 403)
  if (!(await signedBy(s))) {
    const other = await recovered(s)
    console.warn('community: signature check failed', { kind: s.kind, attester: s.message.attester, recovered: other, sigBytes: (s.signature.length - 2) / 2 })
    return fail(other && other !== user
      ? `Your wallet signed as ${other}, but you're signed in as ${user}. Sign out and in again with the same wallet.`
      : 'The signature does not match your wallet', 401)
  }

  try {
    if (s.kind === 'revoke') {
      const target = await getSigned(s.message.uid)
      if (!target || target.attester !== user) return fail('You can only withdraw your own labels and votes', 403)
      await revokeSigned(s)
      return NextResponse.json({ uid: s.message.uid, revoked: true })
    }
    if (s.kind === 'vote') {
      const target = await getSigned(s.message.label)
      if (!target || target.kind !== 'label' || target.revoked) return fail('That label no longer exists', 404)
      if (target.attester === user) return fail("You can't vote on your own label", 400)
    }
    if ((await countSince(user, new Date(Date.now() - 86400_000))) >= DAILY_LIMIT) return fail('Daily limit reached. Try again tomorrow.', 429)
    const uid = uidOf(s)
    await insertSigned(uid, s)
    return NextResponse.json({ uid })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not save', e instanceof StoreNotConfigured ? 503 : 502)
  }
}

export async function GET(req: NextRequest) {
  const headers = { 'access-control-allow-origin': '*' }
  const uid = req.nextUrl.searchParams.get('uid') ?? ''
  if (!/^0x[0-9a-f]{64}$/.test(uid)) return NextResponse.json({ error: 'Pass ?uid=0x…' }, { status: 400, headers })
  try {
    const row = await getSigned(uid)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
    const signed = { kind: row.kind, message: row.message } as Signed
    return NextResponse.json({
      uid: row.uid,
      signer: row.attester,
      revoked: row.revoked,
      // Check it yourself: viem verifyTypedData({ address: signer, signature, ...typedData })
      typedData: JSON.parse(JSON.stringify(typedData(signed), (_, v) => (typeof v === 'bigint' ? Number(v) : v))),
      signature: row.signature,
      revocation: row.revocation,
    }, { headers })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read' }, { status: e instanceof StoreNotConfigured ? 503 : 502, headers })
  }
}
