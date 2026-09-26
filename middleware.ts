import { NextRequest, NextResponse } from 'next/server'
import { readSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

// Every API route needs a signed-in account (the data calls cost real API quota), except
// sign-in itself, the public community-label reads and scheduled jobs (which check their own secret).

const PUBLIC = [/^\/api\/auth\//, /^\/api\/community(\/|$)/, /^\/api\/cron\//]

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  if (PUBLIC.some(r => r.test(path))) return NextResponse.next()
  if (readSessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next()
  return NextResponse.json({ error: 'Sign in to use Ashiato' }, { status: 401 })
}

export const config = { matcher: '/api/:path*', runtime: 'nodejs' }
