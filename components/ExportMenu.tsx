'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Upload, FileText, Image as ImageIcon, Share2, Table } from 'lucide-react'

interface Props {
  onSaveCase: () => void
  onLoadCase: (file: File) => void
  onReport: () => void
  onPng: () => void
  onCsv: () => void
  onGraphml: () => void
}

export default function ExportMenu(p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  const items: [string, React.ReactNode, () => void][] = [
    ['Printable report', <FileText key="r" size={13} />, p.onReport],
    ['Save case file', <Download key="s" size={13} />, p.onSaveCase],
    ['Open case file…', <Upload key="o" size={13} />, () => fileRef.current?.click()],
    ['Graph image (PNG)', <ImageIcon key="p" size={13} />, p.onPng],
    ['Flows (CSV)', <Table key="c" size={13} />, p.onCsv],
    ['Graph (GraphML)', <Share2 key="g" size={13} />, p.onGraphml],
  ]

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 h-8 px-2.5 text-[11px] font-medium bg-raised hover:bg-line text-fg">
        Export <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-52 bg-panel border border-line shadow-2xl py-1">
          {items.map(([label, icon, fn]) => (
            <button key={label} onClick={() => { setOpen(false); fn() }} className="w-full flex items-center gap-2.5 h-8 px-3 text-[12px] text-fg hover:bg-raised">
              <span className="text-faint">{icon}</span>{label}
            </button>
          ))}
          <p className="px-3 py-1.5 text-[10px] text-faint border-t border-line mt-1">Case files stay on your computer.</p>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) p.onLoadCase(f); e.target.value = '' }} />
    </div>
  )
}
