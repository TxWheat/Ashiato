'use client'

import { chainDot } from '@/lib/format'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, AlertCircle, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { detectInput, searchUrl, SearchTarget, truncate } from '@/lib/detect-chain'

/**
 * Address or transaction search. `compact` is the version used in the trace page header;
 * there, with `onAddAddress`, an address is added to the open case instead of starting a new one.
 */
const PLACEHOLDER = 'Address or transaction hash'

/** Types the text out, holds, erases and repeats (all at once for reduced motion) */
function useTypewriter(text: string, enabled: boolean, typeMs = 70, eraseMs = 35, holdMs = 2500, pauseMs = 500): string {
  const [shown, setShown] = useState(enabled ? '' : text)
  useEffect(() => {
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(text)
    let i = 0
    let erasing = false
    const tick = () => {
      i += erasing ? -1 : 1
      setShown(text.slice(0, i))
      let wait = erasing ? eraseMs : typeMs
      if (!erasing && i === text.length) { erasing = true; wait = holdMs }
      else if (erasing && i === 0) { erasing = false; wait = pauseMs }
      timer = setTimeout(tick, wait)
    }
    let timer = setTimeout(tick, 400)
    return () => clearTimeout(timer)
  }, [text, enabled, typeMs, eraseMs, holdMs, pauseMs])
  return shown
}

export default function SearchForm({ compact = false, onAddAddress }: { compact?: boolean; onAddAddress?: (address: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  /** A new case waiting for its name (it's saved under that name as soon as it opens) */
  const [naming, setNaming] = useState<SearchTarget | null>(null)
  const [caseName, setCaseName] = useState('')
  const typed = useTypewriter(PLACEHOLDER, !compact)
  const typedPlaceholder = typed.length < PLACEHOLDER.length ? `${typed}▏` : typed
  const router = useRouter()
  const target = detectInput(value)

  const suggestName = (t: SearchTarget) => `${truncate(t.value, 6)} · ${new Date().toLocaleDateString('en-NZ')}`
  const startCase = (t: SearchTarget, name: string) => {
    setNaming(null)
    setValue('')
    router.push(`${searchUrl(t)}&name=${encodeURIComponent(name.trim() || suggestName(t))}`)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) {
      setError('Enter a Bitcoin, Ethereum or Tron address, or a transaction hash')
      return
    }
    if (onAddAddress && target.kind === 'address') {
      setValue('')
      onAddAddress(target.value)
    } else if (compact) {
      openNew()
    } else {
      // A new case gets a name first, so it's saved from the start
      setCaseName(suggestName(target))
      setNaming(target)
    }
  }
  const openNew = () => {
    if (!target) return
    const name = window.prompt('Name the new case', suggestName(target))
    if (name === null) return
    startCase(target, name)
  }
  const adds = !!onAddAddress && target?.kind === 'address'

  const badge = target && (
    <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted pointer-events-none">
      <span className={`w-1.5 h-1.5 rounded-full ${chainDot(target.chain)}`} />
      {target.chain} {target.kind === 'tx' ? 'transaction' : 'address'}
    </span>
  )

  if (compact) {
    return (
      <form onSubmit={submit} className="relative w-full max-w-md">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          placeholder={onAddAddress ? 'Add an address to this case, or search a transaction…' : 'Search address or transaction…'}
          aria-label="Search address or transaction"
          aria-invalid={!!error}
          aria-describedby={error ? 'search-error' : undefined}
          spellCheck={false}
          autoComplete="off"
          className={clsx('w-full h-8 bg-panel border pl-8 font-mono text-xs text-fg placeholder:text-faint outline-none', adds ? 'pr-40 sm:pr-[15.5rem]' : 'pr-36', error ? 'border-red-500' : 'border-line focus:border-accent')}
        />
        {adds ? (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted pointer-events-none pr-1">
              <span className={`w-1.5 h-1.5 rounded-full ${chainDot(target!.chain)}`} />{target!.chain}
            </span>
            <button type="submit" className="h-6 px-2 text-[10px] font-medium bg-accent hover:bg-accent-hover text-accent-fg whitespace-nowrap" title="Put this address on the graph of the open case (Enter)">
              Add to case
            </button>
            <button type="button" onClick={openNew} className="h-6 px-2 text-[10px] font-medium bg-raised hover:bg-line text-fg whitespace-nowrap" title="Start a separate trace from this address (the open case stays saved)">
              New case
            </button>
          </span>
        ) : badge}
        {error && (
          <div id="search-error" role="alert" className="absolute left-0 right-0 top-full mt-1 z-30 flex items-center gap-1.5 bg-panel border border-red-500/50 px-2 py-1.5 text-[11px] text-red-500 shadow-lg">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}
      </form>
    )
  }

  if (naming) {
    return (
      <form onSubmit={e => { e.preventDefault(); startCase(naming, caseName) }} className="w-full max-w-xl space-y-3">
        <label htmlFor="case-name" className="block text-[10px] font-medium uppercase tracking-wider text-faint">
          Name this case <span className="normal-case tracking-normal">· {naming.chain} {naming.kind === 'tx' ? 'transaction' : 'address'} <span className="font-mono">{truncate(naming.value, 8)}</span></span>
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input id="case-name" value={caseName} onChange={e => setCaseName(e.target.value)} autoFocus maxLength={80}
            placeholder="e.g. Jane Doe · USDT investment scam"
            className="flex-1 h-12 bg-panel border border-line focus:border-accent px-4 text-sm text-fg placeholder:text-faint outline-none" />
          <button type="submit" className="h-12 px-5 bg-accent hover:bg-accent-hover text-accent-fg font-medium">Start case</button>
          <button type="button" onClick={() => setNaming(null)} className="h-12 px-4 border border-line text-muted hover:text-fg">Back</button>
        </div>
        <p className="text-xs text-faint">The case is saved to your account under this name as soon as it opens. You can rename it later.</p>
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
            placeholder={typedPlaceholder}
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
