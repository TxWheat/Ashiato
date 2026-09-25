'use client'

import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ExternalLink, ShieldCheck, ThumbsDown, ThumbsUp, Users, Undo2 } from 'lucide-react'
import { Chain } from '@/lib/types'
import { truncate } from '@/lib/detect-chain'
import { ACCUSING, ATTEST_CHAIN, COMMUNITY_CATEGORIES, CommunityCategory, attestationUrl } from '@/lib/attest/config'
import { checkLabel, LabelInput, VoteInput } from '@/lib/attest/encode'
import type { CommunityLabel, TrustStatus } from '@/lib/attest/trust'

/** What the connected wallet can do; the page passes this in once a wallet is connected */
export interface Attester {
  /** Lowercase address of the connected wallet */
  address: string
  label: (input: LabelInput) => Promise<unknown>
  vote: (labelUid: `0x${string}`, vote: VoteInput) => Promise<unknown>
  revoke: (labelUid: `0x${string}`) => Promise<unknown>
}

const CATEGORY_NAME: Record<CommunityCategory, string> = {
  scam: 'Scam', phishing: 'Phishing', hack: 'Hack / exploit', 'exchange-deposit': 'Exchange deposit',
  exchange: 'Exchange', mixer: 'Mixer', service: 'Service / contract', cleared: 'Cleared (not a scam)',
}
const STATUS: Record<TrustStatus, string> = {
  trusted: 'bg-green-500', contested: 'bg-amber-500', disputed: 'bg-red-500',
}
const VOTES: [VoteInput['trust'], string][] = [[2, 'Confirmed'], [1, 'Plausible'], [-1, 'Doubtful'], [-2, 'Wrong']]

const who = (address: string, name?: string) => name ?? truncate(address, 5)
const day = (t: number) => new Date(t * 1000).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })

interface Props {
  chain: Chain
  address: string
  attester?: Attester
  /** Pre-fills the evidence field (e.g. the selected transactions) */
  evidenceHint?: string
}

/** Labels investigators attested on-chain for this address, with trust votes */
export default function CommunityLabels({ chain, address, attester, evidenceHint }: Props) {
  const [labels, setLabels] = useState<CommunityLabel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flagging, setFlagging] = useState(false)

  const load = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(`/api/community/${chain}/${encodeURIComponent(address)}${fresh ? '?fresh=1' : ''}`)
      const body = await res.json()
      setLabels(body.labels ?? [])
      setError(res.ok ? null : body.error ?? 'Could not read community labels')
    } catch {
      setError('Could not read community labels')
      setLabels([])
    }
  }, [chain, address])

  useEffect(() => {
    setLabels(null)
    setFlagging(false)
    load()
  }, [load])

  /** Runs a wallet action, then re-reads (the indexer can take a little while) */
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load(true)
      setTimeout(() => load(true), 8000)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'The wallet action failed')
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-faint">
        <Users size={11} /> Community labels
        <span className="normal-case tracking-normal font-normal">on {ATTEST_CHAIN.name}</span>
        {attester && !flagging && (
          <button onClick={() => setFlagging(true)} className="ml-auto h-6 px-2 text-[10px] font-medium normal-case tracking-normal bg-accent hover:bg-accent-hover text-accent-fg">
            Flag on-chain
          </button>
        )}
      </div>

      {labels === null && <p className="text-[11px] text-faint">Loading…</p>}
      {labels?.length === 0 && !flagging && (
        <p className="text-[11px] text-faint">{attester ? 'No investigator has labelled this address yet.' : 'None yet. Connect a wallet to add one.'}</p>
      )}

      {labels?.map(l => {
        const mine = attester?.address === l.attester
        const myVote = l.votes.find(v => v.voter === attester?.address)
        return (
          <div key={l.uid} className="border border-line p-2.5 space-y-1.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 bg-raised text-fg font-medium">{CATEGORY_NAME[l.category]}</span>
              <span className="text-fg font-medium truncate flex-1">{l.name}</span>
              <a href={attestationUrl(l.uid)} target="_blank" rel="noopener noreferrer" title="View the attestation" className="text-faint hover:text-fg"><ExternalLink size={11} /></a>
            </div>
            <div className="flex items-center gap-2" title={`${l.support} support · ${l.disputes} dispute${l.disputes === 1 ? '' : 's'}, weighted (verified ENS names count double; the creator counts as a strong yes)`}>
              <span className="text-faint">Trust</span>
              <span className="flex-1 h-1 bg-raised"><span className={clsx('block h-full', STATUS[l.status])} style={{ width: `${Math.max(3, l.trust)}%` }} /></span>
              <span className="font-mono text-fg">{l.trust}%</span>
              <span className="text-faint">· {l.votes.length} vote{l.votes.length === 1 ? '' : 's'}{l.disputes ? ` (${l.disputes} dispute${l.disputes === 1 ? '' : 's'})` : ''}</span>
            </div>
            <div className="text-faint">
              By <span className="text-fg">{who(l.attester, l.attesterName)}</span> · {day(l.time)} · confidence {l.confidence}%
            </div>
            {l.evidence && <div className="text-faint break-all">Evidence: <span className="text-muted">{l.evidence}</span></div>}
            {l.votes.length > 0 && (
              <details className="text-faint">
                <summary className="cursor-pointer hover:text-fg">Votes</summary>
                <ul className="mt-1 space-y-0.5">
                  {l.votes.map(v => (
                    <li key={v.uid}>
                      <span className={v.trust > 0 ? 'text-green-500' : 'text-red-500'}>{v.trust > 0 ? '+' : ''}{v.trust}</span>{' '}
                      <span className="text-fg">{who(v.voter, v.voterName)}</span>{v.weight > 1 && <span title="Verified ENS name"> ×{v.weight}</span>}
                      {v.reason && <span>: {v.reason}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {attester && (mine ? (
              <button onClick={() => act(`revoke-${l.uid}`, () => attester.revoke(l.uid as `0x${string}`))} disabled={!!busy}
                className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium bg-raised hover:bg-line text-fg disabled:opacity-40">
                <Undo2 size={10} /> {busy === `revoke-${l.uid}` ? 'Confirm in wallet…' : 'Withdraw my label'}
              </button>
            ) : (
              <VoteRow current={myVote?.trust} busy={busy?.startsWith(`vote-${l.uid}`) ? busy : null} disabled={!!busy}
                onVote={v => act(`vote-${l.uid}`, () => attester.vote(l.uid as `0x${string}`, v))} />
            ))}
          </div>
        )
      })}

      {flagging && attester && (
        <FlagForm chain={chain} address={address} evidenceHint={evidenceHint} busy={busy === 'flag'}
          onCancel={() => setFlagging(false)}
          onSubmit={async input => { if (await act('flag', () => attester.label(input))) setFlagging(false) }} />
      )}
      {error && (
        <p className="text-[11px] text-red-500 break-words">
          {error.split(/(https?:\/\/\S+)/).map((part, i) =>
            /^https?:\/\//.test(part)
              ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg">{part.replace(/^https?:\/\//, '').split('/')[0]}</a>
              : part)}
        </p>
      )}
    </div>
  )
}

function VoteRow({ current, busy, disabled, onVote }: { current?: number; busy: string | null; disabled: boolean; onVote: (v: VoteInput) => void }) {
  const [disputing, setDisputing] = useState<VoteInput['trust'] | null>(null)
  const [reason, setReason] = useState('')
  if (busy) return <p className="text-[10px] text-muted">Confirm in your wallet…</p>
  if (disputing) {
    return (
      <div className="flex gap-1">
        <input autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Why? e.g. it's the MetaMask swap router"
          className="flex-1 h-6 px-2 text-[10px] bg-bg border border-line text-fg outline-none focus:border-accent" aria-label="Reason" />
        <button disabled={!reason.trim()} onClick={() => { onVote({ trust: disputing, reason }); setDisputing(null) }}
          className="h-6 px-2 text-[10px] font-medium bg-accent text-accent-fg disabled:opacity-40">Vote</button>
        <button onClick={() => setDisputing(null)} className="h-6 px-2 text-[10px] text-faint hover:text-fg">Cancel</button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-faint mr-1">Your vote</span>
      {VOTES.map(([t, name]) => (
        <button key={t} disabled={disabled} title={name}
          onClick={() => (t < 0 ? setDisputing(t) : onVote({ trust: t, reason: '' }))}
          className={clsx('flex items-center gap-0.5 h-6 px-1.5 text-[10px] font-medium disabled:opacity-40',
            current === t ? (t > 0 ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500') : 'bg-raised hover:bg-line text-fg')}>
          {t > 0 ? <ThumbsUp size={10} /> : <ThumbsDown size={10} />}{name}
        </button>
      ))}
    </div>
  )
}

function FlagForm({ chain, address, evidenceHint, busy, onSubmit, onCancel }: {
  chain: Chain; address: string; evidenceHint?: string; busy: boolean
  onSubmit: (l: LabelInput) => void; onCancel: () => void
}) {
  const [category, setCategory] = useState<CommunityCategory>('scam')
  const [name, setName] = useState('')
  const [evidence, setEvidence] = useState(evidenceHint ?? '')
  const [confidence, setConfidence] = useState(80)
  const input: LabelInput = { chain, subject: address, category, name, evidence, confidence }
  const errs = checkLabel(input)
  const field = 'w-full h-7 px-2 text-[11px] bg-bg border border-line text-fg outline-none focus:border-accent'
  return (
    <div className="border border-accent/50 p-2.5 space-y-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-fg font-medium"><ShieldCheck size={12} /> Flag this address on-chain</div>
      <select value={category} onChange={e => setCategory(e.target.value as CommunityCategory)} className={field} aria-label="Category">
        {COMMUNITY_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_NAME[c]}</option>)}
      </select>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Name, e.g. Fake USDT investment platform" className={field} aria-label="Label name" />
      <textarea value={evidence} onChange={e => setEvidence(e.target.value)} maxLength={1000} rows={2}
        placeholder={ACCUSING.includes(category) ? 'Evidence (required): tx hashes, report hash or a link' : 'Evidence (optional)'}
        className="w-full px-2 py-1 text-[11px] bg-bg border border-line text-fg outline-none focus:border-accent resize-y" aria-label="Evidence" />
      <label className="flex items-center gap-2 text-faint">
        Confidence
        <input type="range" min={10} max={100} step={10} value={confidence} onChange={e => setConfidence(+e.target.value)} className="flex-1" />
        <span className="font-mono text-fg w-9 text-right">{confidence}%</span>
      </label>
      <p className="text-[10px] text-faint">Public and permanent on {ATTEST_CHAIN.name}, signed by your wallet. Never include a victim&apos;s personal details.</p>
      <div className="flex gap-1.5">
        <button onClick={() => onSubmit(input)} disabled={busy || errs.length > 0} title={errs.join('. ')}
          className="h-7 px-3 text-[11px] font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-40">
          {busy ? 'Confirm in wallet…' : 'Sign & publish'}
        </button>
        <button onClick={onCancel} className="h-7 px-3 text-[11px] text-faint hover:text-fg">Cancel</button>
      </div>
    </div>
  )
}
