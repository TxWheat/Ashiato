import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { StoreNotConfigured } from '@/lib/supabase'
import { checkUsdcPayment, paymentsTestMode } from '@/lib/billing/verify'
import { addPayment, paymentById, proUntil } from '@/lib/billing/store'
import { monthsFor, PAY_CHAINS, payChains, PayChain, PRO_PLANS } from '@/lib/billing/plans'

// Credits a USDC payment: checks on-chain that the signed-in wallet sent it to Ashiato,
// then adds the months it covers. Safe to call again with the same transaction.

const fail = (error: string, status: number, retry = false) => NextResponse.json({ error, retry }, { status })

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return fail('Sign in first', 401)
  const payTo = process.env.PAYMENT_ADDRESS?.toLowerCase()
  if (!payTo || !/^0x[0-9a-f]{40}$/.test(payTo)) return fail('Payments are not set up on this server yet', 503)
  const body = await req.json().catch(() => null) as { chain?: string; txHash?: string } | null
  const chain = body?.chain as PayChain
  const hash = body?.txHash?.trim().toLowerCase()
  const networks = payChains(paymentsTestMode())
  if (!networks.includes(chain)) return fail(`Payments are taken on ${networks.map(n => PAY_CHAINS[n].name).join(' or ')}`, 400)
  if (!hash || !/^0x[0-9a-f]{64}$/.test(hash)) return fail('Paste the transaction hash (0x…)', 400)

  const id = `${chain}:${hash}`
  try {
    const seen = await paymentById(id)
    if (seen) {
      if (seen.wallet !== user) return fail('That payment was already used by another account', 409)
      return NextResponse.json({ credited: false, months: seen.months, expiresAt: (await proUntil(user))?.toISOString() ?? null })
    }
    const check = await checkUsdcPayment(chain, hash as `0x${string}`, user, payTo)
    if (!check.ok) return fail(check.error, check.retry ? 202 : 400, check.retry)
    const months = monthsFor(check.usdc)
    if (!months) return fail(`That payment was ${check.usdc} USDC; Pro starts at ${PRO_PLANS[0].usdc} USDC`, 400)
    await addPayment({ id, wallet: user, method: `usdc-${chain}`, amount: check.usdc, currency: 'USDC', months, paid_at: check.paidAt })
    return NextResponse.json({ credited: true, months, expiresAt: (await proUntil(user))?.toISOString() ?? null })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not check the payment', e instanceof StoreNotConfigured ? 503 : 502, true)
  }
}
