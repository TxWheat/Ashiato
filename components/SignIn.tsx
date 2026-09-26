'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, LogOut, Mail, Wallet } from 'lucide-react'
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
  return <AccountMenu address={address} onSignOut={signOut} />
}

/** Signed in: one button with the account's cases and sign-out */
function AccountMenu({ address, onSignOut }: { address: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} title={address}
        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-raised hover:bg-line text-fg whitespace-nowrap">
        <Wallet size={13} /> <span className="font-mono">{truncate(address, 4)}</span> <ChevronDown size={12} className="text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-panel border border-line shadow-xl py-1 text-xs">
          <Link href="/cases" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 h-8 text-fg hover:bg-raised">
            <FolderOpen size={13} /> My cases
          </Link>
          <button onClick={() => { setOpen(false); onSignOut() }} className="w-full flex items-center gap-2 px-3 h-8 text-muted hover:text-fg hover:bg-raised">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
