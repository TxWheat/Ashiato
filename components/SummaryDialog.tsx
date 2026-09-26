'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, FileText, RefreshCw, Sparkles, X } from 'lucide-react'
import type { SummaryFacts } from '@/lib/summary-facts'

/** Plain-English write-up of the case (Pro), to copy or add to the printable report */
export default function SummaryDialog({ facts, summary, onSummary, onReport, onClose }: {
  facts: SummaryFacts
  summary: string | null
  onSummary: (text: string) => void
  onReport: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; upgrade?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const write = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(facts) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) setError({ text: body.error ?? 'Could not write the summary', upgrade: res.status === 402 })
      else onSummary(body.summary)
    } catch {
      setError({ text: 'Could not reach the server' })
    } finally {
      setBusy(false)
    }
  }

  // First open: write it straight away
  useEffect(() => { if (!summary) write() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    if (!summary) return
    navigator.clipboard?.writeText(summary).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  const nothing = !facts.traced.length && !facts.flows.length
  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-bg border border-line shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg"><Sparkles size={14} className="text-accent" /> Plain-English summary</h2>
            <p className="text-[11px] text-faint">Written from this case&apos;s trace for a police report or an exchange. Check it against the graph before you send it.</p>
          </div>
          <button onClick={onClose} className="p-1 text-faint hover:text-fg" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {nothing && !summary && <p className="text-xs text-muted mb-3">Nothing traced yet: the summary will describe the largest flows on the graph. Trace from the victim&apos;s payment first for a better one.</p>}
          {busy && <p className="text-xs text-muted">Writing the summary… this takes up to a minute.</p>}
          {error && (
            <p className="text-xs text-red-500">
              {error.text}
              {error.upgrade && <> · <Link href="/pricing" className="underline underline-offset-2 hover:text-fg">See Pro</Link></>}
            </p>
          )}
          {summary && !busy && <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-fg">{summary}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-line">
          <button onClick={copy} disabled={!summary || busy} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-raised hover:bg-line text-fg disabled:opacity-40">
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={onReport} disabled={!summary || busy} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
            <FileText size={13} /> Open report with this summary
          </button>
          <button onClick={write} disabled={busy} className="ml-auto flex items-center gap-1.5 h-8 px-3 text-xs text-muted hover:text-fg disabled:opacity-40">
            <RefreshCw size={12} /> Write again
          </button>
        </div>
      </div>
    </div>
  )
}
