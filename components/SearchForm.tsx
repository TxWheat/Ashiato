'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, AlertCircle } from 'lucide-react'
import { detectChain } from '@/lib/detect-chain'

export default function SearchForm() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()
  const chain = detectChain(address)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chain) {
      setError('Enter a valid Bitcoin or Ethereum address')
      return
    }
    router.push(`/trace?address=${encodeURIComponent(address.trim())}&chain=${chain}`)
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={address}
            onChange={e => {
              setAddress(e.target.value)
              setError('')
            }}
            placeholder="bc1q… / 1… / 3… / 0x…"
            aria-label="Address to trace"
            className="w-full h-12 bg-panel border border-line focus:border-accent px-4 pr-24 font-mono text-sm text-fg placeholder:text-faint outline-none transition-colors"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {chain && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
              <span className={`w-1.5 h-1.5 rounded-full ${chain === 'btc' ? 'bg-orange-500' : 'bg-violet-500'}`} />
              {chain}
            </span>
          )}
        </div>
        <button
          type="submit"
          className="h-12 flex items-center justify-center gap-3 bg-accent hover:bg-accent-hover text-accent-fg pl-5 pr-2 font-medium transition-colors"
        >
          Trace
          <span className="grid place-items-center w-7 h-7 bg-accent-fg text-accent">
            <ArrowUpRight size={16} />
          </span>
        </button>
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
          <AlertCircle size={14} />
          {error}
        </div>
      )}
    </form>
  )
}
