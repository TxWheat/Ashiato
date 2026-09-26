import { NextRequest, NextResponse } from 'next/server'
import { isCurrency } from '@/lib/currency'
import { dailyPrices } from '@/lib/price-history'

export const maxDuration = 30

/** Daily closing prices (UTC) for BTC, ETH, TRX and USD stablecoins in ?currency= */
export async function GET(req: NextRequest) {
  const currency = req.nextUrl.searchParams.get('currency') ?? 'USD'
  if (!isCurrency(currency)) return NextResponse.json({ error: 'Unknown currency' }, { status: 400 })
  try {
    return NextResponse.json({ currency, prices: await dailyPrices(currency) }, { headers: { 'cache-control': 'public, max-age=3600' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Price history unavailable' }, { status: 502 })
  }
}
