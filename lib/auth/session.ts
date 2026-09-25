import 'server-only'
import crypto from 'node:crypto'
import { cookies } from 'next/headers'

// Sign-In with Ethereum sessions without a user table: a nonce and a session are both
// HMAC-signed tokens, so the server keeps no state. The session holds only the wallet
// address (email sign-ins get a wallet from Reown, so they work the same way).

export const SESSION_COOKIE = 'ashiato_session'
const SESSION_DAYS = 30
const NONCE_MINUTES = 10

let devSecret: string | undefined
function secret(): string {
  const s = process.env.AUTH_SECRET
  if (s && s.length >= 32) return s
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set (32+ random characters)')
  devSecret ??= crypto.randomBytes(32).toString('hex') // dev only: sessions reset on restart
  return devSecret
}

const sign = (data: string) => crypto.createHmac('sha256', secret()).update(data).digest('base64url')
const equal = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

const nonceSig = (t: string) => sign(`nonce:${t}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)

/** Alphanumeric (SIWE nonces must be): 9-char issue time + 24-char signature */
export function makeNonce(now = Date.now()): string {
  const t = now.toString(36).padStart(9, '0')
  return `${t}${nonceSig(t)}`
}

export function nonceValid(nonce: string, now = Date.now()): boolean {
  if (!/^[a-z0-9]{9}[a-zA-Z0-9]{24}$/.test(nonce)) return false
  const t = nonce.slice(0, 9)
  const age = now - parseInt(t, 36)
  if (!(age >= -60_000 && age <= NONCE_MINUTES * 60_000)) return false
  return equal(nonce.slice(9), nonceSig(t))
}

export function createSession(address: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ a: address.toLowerCase(), e: now + SESSION_DAYS * 86400_000 })).toString('base64url')
  return `${body}.${sign(`session:${body}`)}`
}

export function readSessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig || !equal(sig, sign(`session:${body}`))) return null
  try {
    const { a, e } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a) && e > now ? a : null
  } catch {
    return null
  }
}

/** The signed-in wallet address, or null */
export async function currentUser(): Promise<string | null> {
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value)
}

export const sessionCookie = (token: string) => ({
  name: SESSION_COOKIE,
  value: token,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_DAYS * 86400,
})
