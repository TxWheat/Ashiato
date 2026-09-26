import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth/session'
import { storeConfigured } from '@/lib/supabase'
import { paymentsOf } from '@/lib/billing/store'
import { payChains, proExpiry } from '@/lib/billing/plans'
import { paymentsTestMode } from '@/lib/billing/verify'

export const dynamic = 'force-dynamic'

/** The signed-in wallet's plan, and where USDC payments go */
export async function GET() {
  const user = await currentUser()
  const payTo = process.env.PAYMENT_ADDRESS?.toLowerCase()
  const testMode = paymentsTestMode()
  const base = { payTo: payTo && /^0x[0-9a-f]{40}$/.test(payTo) ? payTo : null, testMode, networks: payChains(testMode) }
  if (!user || !storeConfigured()) return NextResponse.json({ ...base, pro: false, expiresAt: null, payments: [] })
  try {
    const payments = await paymentsOf(user)
    const end = proExpiry(payments.map(p => ({ months: p.months, paidAt: p.paid_at })))
    const pro = !!end && end > new Date()
    return NextResponse.json({
      ...base, pro, expiresAt: pro ? end!.toISOString() : null,
      payments: payments.map(p => ({ id: p.id, method: p.method, amount: p.amount, currency: p.currency, months: p.months, paidAt: p.paid_at })).reverse(),
    }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ ...base, error: e instanceof Error ? e.message : 'Could not read your plan' }, { status: 502 })
  }
}
