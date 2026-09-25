'use client'

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Save, ChevronDown, Check, Loader2 } from 'lucide-react'
import { useAuth } from './Providers'

type Status = 'new' | 'dirty' | 'saving' | 'saved'

interface Props {
  /** Name of the case this chart is saved as, if any */
  savedName?: string
  defaultName: string
  status: Status
  lastSavedAt: number | null
  autosave: boolean
  onAutosave: (on: boolean) => void
  onSave: (name: string, asNew: boolean) => Promise<void>
}

const time = (t: number) => new Date(t).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })

/**
 * Case controls, Breadcrumbs-style: the first Save turns the chart into a named
 * case; after that Save updates it (or it auto-saves), and Save as… copies it.
 */
export default function SaveChartButton(p: Props) {
  const [menu, setMenu] = useState(false)
  const signedIn = !!useAuth().address
  const [form, setForm] = useState<null | 'new' | 'as'>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu && !form) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setMenu(false)
        setForm(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu, form])

  const openForm = (mode: 'new' | 'as') => {
    setName(mode === 'as' ? `${p.savedName ?? p.defaultName} (copy)` : p.defaultName)
    setMenu(false)
    setForm(mode)
  }

  const primary = () => (p.savedName ? p.onSave(p.savedName, false) : openForm('new'))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    await p.onSave(name.trim(), form === 'as')
    setBusy(false)
    setForm(null)
  }

  const statusText =
    p.status === 'saving' ? 'Saving…'
      : p.status === 'dirty' ? (p.autosave ? 'Saving soon…' : 'Unsaved changes')
        : p.status === 'saved' && p.lastSavedAt ? `Saved ${time(p.lastSavedAt)}`
          : null

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {p.savedName && (
        <span className="hidden md:flex items-center gap-1.5 max-w-[220px] text-[11px]" title={`Case: ${p.savedName}`}>
          <span className="truncate text-fg font-medium">{p.savedName}</span>
          {statusText && (
            <span className={clsx('flex items-center gap-1 whitespace-nowrap', p.status === 'dirty' && !p.autosave ? 'text-yellow-500' : 'text-faint')}>
              {p.status === 'saving' ? <Loader2 size={11} className="animate-spin" /> : p.status === 'saved' ? <Check size={11} /> : null}
              {statusText}
            </span>
          )}
        </span>
      )}
      <div className="flex">
        <button
          onClick={primary}
          disabled={p.status === 'saving'}
          className="flex items-center gap-1.5 h-8 pl-3 pr-2.5 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-60"
          title={p.savedName ? `Save changes to “${p.savedName}”` : 'Save this chart as a case'}
        >
          <Save size={13} /> {p.savedName ? 'Save' : 'Save case'}
        </button>
        <button
          onClick={() => { setForm(null); setMenu(m => !m) }}
          aria-label="More save options"
          className="grid place-items-center h-8 w-7 bg-accent hover:bg-accent-hover text-accent-fg border-l border-accent-fg/20"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {menu && (
        <div className="absolute right-0 top-10 z-40 w-64 bg-panel border border-line shadow-xl py-1 text-[12px]">
          {p.savedName && (
            <button onClick={() => { setMenu(false); p.onSave(p.savedName!, false) }} className="w-full text-left px-3 py-2 hover:bg-raised text-fg">
              Save
            </button>
          )}
          <button onClick={() => openForm(p.savedName ? 'as' : 'new')} className="w-full text-left px-3 py-2 hover:bg-raised text-fg">
            {p.savedName ? 'Save as new case…' : 'Save as case…'}
          </button>
          <label className="flex items-start gap-2 px-3 py-2 hover:bg-raised cursor-pointer border-t border-line mt-1">
            <input type="checkbox" checked={p.autosave} onChange={e => p.onAutosave(e.target.checked)} className="mt-0.5 accent-[rgb(var(--accent))]" />
            <span>
              <span className="text-fg">Auto-save</span>
              <span className="block text-[10px] text-faint leading-relaxed">Saves a case a moment after each change. New charts are saved once you give them a name.</span>
            </span>
          </label>
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="absolute right-0 top-10 z-40 w-72 bg-panel border border-line shadow-xl p-3 space-y-2">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-faint" htmlFor="chart-name">
            {form === 'as' ? 'Save a copy as' : 'Case name'}
          </label>
          <input id="chart-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80}
            className="w-full h-8 px-2 text-[12px] bg-bg border border-line text-fg outline-none focus:border-accent" />
          <p className="text-[10px] text-faint leading-relaxed">
            {signedIn
              ? <>Saved to your account with the layout, transactions, traces, notes and labels. Reopen it from <b className="text-fg font-medium">My cases</b> on any device.</>
              : <>Saved in this browser with the layout, transactions, traces, notes and labels. Sign in to keep it in your account and open it on any device.</>}
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setForm(null)} className="h-7 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()} className="h-7 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
              {busy ? 'Saving…' : form === 'as' ? 'Save copy' : 'Create case'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
