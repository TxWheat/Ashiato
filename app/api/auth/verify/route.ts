import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { parseSiweMessage } from 'viem/siwe'
import { createSession, nonceValid, sessionCookie } from '@/lib/auth/session'

// Checks a Sign-In with Ethereum signature and starts a session. verifySiweMessage also
// accepts smart-contract wallets (EIP-1271/6492), which is what email sign-ins create.
const RPC: Record<number, string | undefined> = {
  1: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
  11155111: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
}

export async function POST(req: NextRequest) {
  let body: { message?: string; signature?: `0x${string}` }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const { message, signature } = body
  if (typeof message !== 'string' || typeof signature !== 'string' || message.length > 2000) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const fields = parseSiweMessage(message)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  if (!fields.address || !fields.nonce || !fields.chainId || fields.domain !== host) {
    return NextResponse.json({ error: 'This sign-in message is not for this site' }, { status: 400 })
  }
  if (!nonceValid(fields.nonce)) return NextResponse.json({ error: 'Sign-in expired. Try again.' }, { status: 400 })
  const chain = fields.chainId === sepolia.id ? sepolia : mainnet
  const client = createPublicClient({ chain, transport: http(RPC[chain.id]) })
  const ok = await client.verifySiweMessage({ message, signature, domain: host, nonce: fields.nonce }).catch(() => false)
  if (!ok) return NextResponse.json({ error: 'The signature does not match this wallet' }, { status: 401 })

  const address = fields.address.toLowerCase()
  const res = NextResponse.json({ address })
  res.cookies.set(sessionCookie(createSession(address)))
  return res
}
