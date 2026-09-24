'use client'

import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'

interface Props {
  /** Name of the saved chart this view belongs to, if any */
  savedName?: string
  defaultName: string
  onSave: (name: string) => Promise<void>
}

/** Save the chart to this browser under a name; reopen it from the home page */
export default function SaveChartButton({ savedName, defaultName, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    await onSave(name.trim())
    setBusy(false)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setName(savedName ?? defaultName); setOpen(o => !o) }}
        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg"
        title={savedName ? `Update the saved chart “${savedName}”` : 'Save this chart in your browser'}
      >
        <Save size={13} /> Save
      </button>
      {open && (
        <form onSubmit={submit} className="absolute right-0 top-10 z-40 w-72 bg-panel border border-line shadow-xl p-3 space-y-2">
          <label className="block text-[10px] font-medium uppercase tracking-wider text-faint" htmlFor="chart-name">Chart name</label>
          <input id="chart-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80}
            className="w-full h-8 px-2 text-[12px] bg-bg border border-line text-fg outline-none focus:border-accent" />
          <p className="text-[10px] text-faint leading-relaxed">
            Saved in this browser with the layout, transactions, traces and notes. {savedName ? 'Saving again updates it.' : 'Reopen it from the home page.'}
            {' '}Use Export → Save case file to move it to another computer.
          </p>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setOpen(false)} className="h-7 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()} className="h-7 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
              {busy ? 'Saving…' : savedName ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
