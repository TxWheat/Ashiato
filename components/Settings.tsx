'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { CURRENCIES, CurrencyCode, currencyForLocale, isCurrency } from '@/lib/currency'

// Per-browser display settings (remembered in localStorage)

interface SettingsValue {
  currency: CurrencyCode
  setCurrency: (c: CurrencyCode) => void
}

const SettingsContext = createContext<SettingsValue>({ currency: 'USD', setCurrency: () => {} })
export const useSettings = () => useContext(SettingsContext)

const KEY = 'ashiato.currency'

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [currency, set] = useState<CurrencyCode>('USD')
  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(KEY) } catch { /* storage blocked */ }
    set(isCurrency(saved) ? saved : currencyForLocale(navigator.language))
  }, [])
  const setCurrency = (c: CurrencyCode) => {
    set(c)
    try { localStorage.setItem(KEY, c) } catch { /* storage blocked */ }
  }
  return <SettingsContext.Provider value={{ currency, setCurrency }}>{children}</SettingsContext.Provider>
}

/** Gear button with the settings popover (sits next to the theme toggle) */
export function SettingsButton() {
  const { currency, setCurrency } = useSettings()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} aria-label="Settings" aria-expanded={open} title="Settings"
        className={`grid place-items-center w-9 h-9 border border-line ${open ? 'bg-raised text-fg' : 'text-faint hover:text-fg'}`}>
        <SettingsIcon size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-panel border border-line shadow-xl p-4 space-y-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Settings</div>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Show values in</span>
            <select value={currency} onChange={e => setCurrency(e.target.value as CurrencyCode)}
              className="w-full h-9 px-2 bg-bg border border-line text-sm text-fg outline-none focus:border-accent">
              {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <p className="text-[11px] text-faint leading-relaxed">Values use today&apos;s prices. Saved in this browser.</p>
        </div>
      )}
    </div>
  )
}
