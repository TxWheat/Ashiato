'use client'

import { chainDot } from '@/lib/format'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, AlertCircle, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { detectInput, searchUrl } from '@/lib/detect-chain'

/** Address or transaction search. `compact` is the version used in the trace page header. */
export default function SearchForm({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()
  const target = detectInput(value)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) {
      setError('Enter a Bitcoin, Ethereum or Tron address, or a transaction hash')
      return
    }
    setValue('')
    router.push(searchUrl(target))
  }

  const badge = target && (
    <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted pointer-events-none">
      <span className={`w-1.5 h-1.5 rounded-full ${chainDot(target.chain)}`} />
      {target.chain} {target.kind === 'tx' ? 'transaction' : 'address'}
    </span>
  )

  if (compact) {
    return (
      <form onSubmit={submit} className="relative w-full max-w-md" title={error || undefined}>
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          placeholder="Search address or transaction…"
          aria-label="Search address or transaction"
          spellCheck={false}
          autoComplete="off"
          className={clsx('w-full h-8 bg-panel border pl-8 pr-36 font-mono text-xs text-fg placeholder:text-faint outline-none', error ? 'border-red-500' : 'border-line focus:border-accent')}
        />
        {badge}
      </form>
    )
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={e => { setValue(e.target.value); setError('') }}
            placeholder="Address or transaction hash"
            aria-label="Address or transaction to trace"
            className="w-full h-12 bg-panel border border-line focus:border-accent px-4 pr-36 font-mono text-sm text-fg placeholder:text-faint outline-none transition-colors"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {badge}
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
