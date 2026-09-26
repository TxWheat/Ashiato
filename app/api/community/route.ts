import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { currentUser } from '@/lib/auth/session'
import { StoreNotConfigured } from '@/lib/supabase'
import { cleanSigned, Signed, typedData, uidOf, verifySigned } from '@/lib/attest/signed'
import { countSince, getSigned, insertSigned, revokeSigned } from '@/lib/attest/store'

// Signed community labels, votes and withdrawals. The wallet signs (free, no transaction);
// the server checks the signature and stores it. GET ?uid= returns the signed record so
// anyone can check it themselves.

const DAILY_LIMIT = 200
const mainnetClient = createPublicClient({ chain: mainnet, transport: http(process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com') })

/** Ordinary wallets are checked offline; smart-contract wallets (email sign-ins) over RPC */
async function signedBy(s: Signed): Promise<boolean> {
  if (await verifySigned(s)) return true
  return mainnetClient.verifyTypedData({ address: s.message.attester, signature: s.signature, ...typedData(s) } as unknown as Parameters<typeof mainnetClient.verifyTypedData>[0]).catch(() => false)
}

const fail = (error: string, status: number) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return fail('Sign in to add or vote on labels', 401)
  const s = cleanSigned(await req.json().catch(() => null))
  if (typeof s === 'string') return fail(s, 400)
  if (s.message.attester !== user) return fail('Sign with the wallet you signed in with', 403)
  if (!(await signedBy(s))) return fail('The signature does not match your wallet', 401)

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
