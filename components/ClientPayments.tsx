'use client'

import { useState } from 'react'
import { clsx } from 'clsx'
import { X, ExternalLink, CheckCircle2, AlertTriangle, HelpCircle, XCircle, ArrowRightFromLine, Trash2 } from 'lucide-react'
import { CheckedPayment, PaymentStatus } from '@/lib/client-payments'
import { explorerTxUrl, fmtAmount } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

const STATUS: Record<PaymentStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  verified: { label: 'Verified', cls: 'bg-green-500/15 text-green-500', icon: <CheckCircle2 size={12} /> },
  mismatch: { label: 'Found, details differ', cls: 'bg-amber-500/15 text-amber-500', icon: <AlertTriangle size={12} /> },
  ambiguous: { label: 'Several matches', cls: 'bg-amber-500/15 text-amber-500', icon: <HelpCircle size={12} /> },
  'not-found': { label: 'Not found', cls: 'bg-red-500/15 text-red-500', icon: <XCircle size={12} /> },
  error: { label: 'Check the line', cls: 'bg-red-500/15 text-red-500', icon: <XCircle size={12} /> },
}

const EXAMPLE = `# One payment per line: tx hash and/or recipient address, amount, asset, date
ebc6db475404ba5aa8c79e509d7495bfbcb919c2f2d86874b36d725bb8342ee4, 2 BTC, 01/07/2017
0x3f4e1bbfb467d23475d4b5dd8154b913a7c61e21, 5000 USDT, 9 Mar 2026`

const day = (t?: number) => (t ? new Date(t * 1000).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = STATUS[status]
  return <span className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap', s.cls)}>{s.icon}{s.label}</span>
}

interface Props {
  payments: CheckedPayment[]
  checking: string | null
  tracing: boolean
  nameOf: (a: string) => string | undefined
  onCheck: (text: string) => void
  onTraceAll: () => void
  onRemove: (id: string) => void
  onShow: (p: CheckedPayment) => void
  onClose: () => void
}

/** Paste what the client gave you; each payment is checked on-chain, then traced together */
export default function ClientPaymentsDialog(p: Props) {
  const [text, setText] = useState('')
  const traceable = p.payments.filter(x => x.match && (x.status === 'verified' || x.status === 'mismatch'))
  const nm = (a: string) => p.nameOf(a) ?? truncate(a, 6)

  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onMouseDown={e => e.target === e.currentTarget && p.onClose()}>
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-bg border border-line shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <h2 className="text-sm font-medium text-fg">Client payments</h2>
            <p className="text-[11px] text-faint">Paste the transaction hashes, wallet addresses, amounts and dates the client gave you. Each one is checked on-chain, then all of them can be traced together.</p>
          </div>
          <button onClick={p.onClose} className="p-1 text-faint hover:text-fg" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-2 border-b border-line">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={EXAMPLE} aria-label="Client payments"
            className="w-full px-3 py-2 font-mono text-[11px] bg-panel border border-line text-fg placeholder:text-faint outline-none focus:border-accent resize-y" />
          <div className="flex items-center gap-3 text-[11px] text-faint">
            <span>Fields in any order, separated by commas, tabs or spaces. Dates like 09/03/2026, 2026-03-09 or 9 Mar 2026. A spreadsheet column pasted in works too.</span>
            <button onClick={() => { p.onCheck(text); setText('') }} disabled={!text.trim() || !!p.checking}
              className="ml-auto h-8 px-4 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50 whitespace-nowrap">
              {p.checking ? 'Checking…' : 'Check payments'}
            </button>
          </div>
          {p.checking && <p className="text-[11px] text-muted flex items-center gap-2"><span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />{p.checking}</p>}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {p.payments.length === 0 ? (
            <p className="p-5 text-[12px] text-faint">No payments yet.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-bg text-[10px] uppercase tracking-wider text-faint">
                <tr className="border-b border-line">
                  <th className="text-left font-normal px-5 py-2 w-8">#</th>
                  <th className="text-left font-normal py-2">Client says</th>
                  <th className="text-left font-normal py-2">On-chain</th>
                  <th className="text-left font-normal py-2">Result</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {p.payments.map((x, i) => (
                  <tr key={x.id} className="border-b border-line/60 align-top">
                    <td className="px-5 py-2.5 text-faint">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <div className="font-mono text-fg">{x.claim.amount !== undefined ? `${x.claim.amount} ${x.claim.asset ?? ''}` : '—'}</div>
                      <div className="text-faint">{day(x.claim.date) || 'no date'}</div>
                      <div className="text-faint font-mono truncate max-w-[220px]" title={x.claim.line}>{x.claim.txid ? `tx ${truncate(x.claim.txid, 8)}` : x.claim.address ? `to ${nm(x.claim.address)}` : x.claim.line}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {x.match ? (
                        <>
                          <div className="font-mono text-fg">{fmtAmount(x.match.amount, x.match.asset, 8)}</div>
                          <div className="text-faint">{day(x.match.timestamp) || 'pending'}</div>
                          <div className="text-faint">
                            {nm(x.match.from)} → <span className="text-fg">{nm(x.match.to)}</span>
                            <a href={explorerTxUrl(x.match.txid, x.match.chain)} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-mono hover:text-fg">
                              {truncate(x.match.txid, 5)} <ExternalLink size={9} />
                            </a>
                          </div>
                        </>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="py-2.5 pr-3 space-y-1">
                      <PaymentStatusBadge status={x.status} />
                      {x.notes.map((n, k) => <div key={k} className="text-faint leading-snug">{n}</div>)}
                      {!!x.claim.errors.length && x.status === 'error' && x.claim.errors.map((n, k) => <div key={k} className="text-red-500 leading-snug">{n}</div>)}
                    </td>
                    <td className="py-2.5 pr-5 text-right whitespace-nowrap">
                      {x.match && <button onClick={() => p.onShow(x)} className="h-6 px-1.5 text-[10px] font-medium bg-raised hover:bg-line text-fg mr-1">Show</button>}
                      <button onClick={() => p.onRemove(x.id)} className="p-1 text-faint hover:text-red-500" aria-label="Remove"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-line text-[11px]">
          <span className="text-faint">
            {p.payments.filter(x => x.status === 'verified').length} verified · {p.payments.filter(x => x.status === 'mismatch' || x.status === 'ambiguous').length} to review · {p.payments.filter(x => x.status === 'not-found' || x.status === 'error').length} not found
          </span>
          <button onClick={p.onTraceAll} disabled={!traceable.length || p.tracing}
            className="ml-auto flex items-center gap-1.5 h-8 px-4 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
            Trace {traceable.length} payment{traceable.length === 1 ? '' : 's'} <ArrowRightFromLine size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
