import 'server-only'
import { eq, supabase } from '../supabase'
import { proExpiry } from './plans'

// Payments in Supabase (table: payments). Pro status is worked out from them, so card
// payments can be added to the same table later.

export interface PaymentRow {
  id: string
  wallet: string
  method: string
  amount: number
  currency: string
  months: number
  paid_at: string
}

export async function paymentsOf(wallet: string): Promise<PaymentRow[]> {
  return supabase<PaymentRow[]>(`payments?wallet=${eq(wallet)}&select=id,wallet,method,amount,currency,months,paid_at&order=paid_at.asc&limit=500`)
}

export async function paymentById(id: string): Promise<PaymentRow | null> {
  return (await supabase<PaymentRow[]>(`payments?id=${eq(id)}&select=id,wallet,method,amount,currency,months,paid_at`))[0] ?? null
}

/** Records a payment once; false when that payment id was already recorded */
export async function addPayment(row: PaymentRow): Promise<boolean> {
  const inserted = await supabase<PaymentRow[]>('payments?on_conflict=id', {
    method: 'POST',
    headers: { prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  })
  return inserted.length > 0
}

export async function proUntil(wallet: string): Promise<Date | null> {
  const end = proExpiry((await paymentsOf(wallet)).map(p => ({ months: p.months, paidAt: p.paid_at })))
  return end && end > new Date() ? end : null
}
