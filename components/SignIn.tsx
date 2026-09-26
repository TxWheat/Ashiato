'use client'

import Link from 'next/link'
import { FolderOpen, LogOut, Mail, Wallet } from 'lucide-react'
import { truncate } from '@/lib/detect-chain'
import { useAuth } from './Providers'

/** Home page: sign in with a wallet or an email; signed in, a way to your cases */
export function SignInPanel() {
  const { address, busy, error, signIn, signOut } = useAuth()
  if (address === undefined) return <div className="h-[92px]" aria-hidden />

  if (address) {
    return (
      <div className="space-y-3">
        <Link href="/cases" className="inline-flex items-center gap-2 h-11 px-5 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg">
          <FolderOpen size={15} /> My cases →
        </Link>
        <p className="text-xs text-faint">
          Signed in as <span className="font-mono text-muted">{truncate(address, 6)}</span> ·{' '}
          <button onClick={signOut} className="underline underline-offset-2 hover:text-fg">Sign out</button>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Sign in to start tracing</div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => signIn('/cases')} disabled={busy}
          className="inline-flex items-center gap-2 h-11 px-5 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
          <Wallet size={15} /> {busy ? 'Check your wallet…' : 'Connect wallet'}
        </button>
        <button onClick={() => signIn('/cases')} disabled={busy}
          className="inline-flex items-center gap-2 h-11 px-5 text-sm font-medium border border-line hover:border-accent text-fg disabled:opacity-50">
          <Mail size={15} /> Sign in with email
        </button>
      </div>
      <p className="text-xs text-faint">
        No password and no personal data stored: an email sign-in gets its own wallet. Your cases are saved to your account and open on any device.
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

/** Compact account control for the top bars */
export function AccountButton({ compact = false }: { compact?: boolean }) {
  const { address, busy, signIn, signOut } = useAuth()
  if (address === undefined) return null
  if (!address) {
    // In the trace header, stay on the open trace rather than leaving it for the cases list
    return (
      <button onClick={() => signIn(compact ? undefined : '/cases')} disabled={busy}
        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-line hover:border-accent text-fg disabled:opacity-50 whitespace-nowrap">
        <Wallet size={13} /> {busy ? 'Signing in…' : 'Sign in'}
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <Link href="/cases" className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-raised hover:bg-line text-fg whitespace-nowrap" title={address}>
        <FolderOpen size={13} /> {compact ? 'Cases' : 'My cases'}
        {!compact && <span className="font-mono text-faint">{truncate(address, 4)}</span>}
      </Link>
      <button onClick={signOut} title="Sign out" aria-label="Sign out" className="h-8 w-8 grid place-items-center text-faint hover:text-fg">
        <LogOut size={13} />
      </button>
    </div>
  )
}
