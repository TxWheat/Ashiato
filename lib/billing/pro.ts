import 'server-only'
import { NextResponse } from 'next/server'
import { currentUser } from '../auth/session'
import { proUntil } from './store'

/** For Pro-only API routes: the signed-in Pro wallet, or the response to send instead */
export async function requirePro(): Promise<{ wallet: string } | { response: NextResponse }> {
  const wallet = await currentUser()
  if (!wallet) return { response: NextResponse.json({ error: 'Sign in first' }, { status: 401 }) }
  const until = await proUntil(wallet).catch(() => null)
  if (!until) return { response: NextResponse.json({ error: 'This is an Ashiato Pro feature', upgrade: '/pricing' }, { status: 402 }) }
  return { wallet }
}
