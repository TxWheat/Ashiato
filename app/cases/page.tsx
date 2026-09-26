'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Plus, Search, Trash2, Upload, Wallet } from 'lucide-react'
import SiteNav from '@/components/SiteNav'
import SearchForm from '@/components/SearchForm'
import { useAuth } from '@/components/Providers'
import { SavedCaseMeta, deleteBrowserCase, deleteCase, listBrowserCases, listCases, moveBrowserCaseToAccount } from '@/lib/saved-cases'
import { chainDot } from '@/lib/format'
import { truncate } from '@/lib/detect-chain'

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

type SortKey = 'name' | 'created' | 'updated'

/** Your cases: in your account when signed in, plus any still only in this browser */
export default function CasesPage() {
  const { address, signIn, busy, error: authError } = useAuth()
  const [cases, setCases] = useState<SavedCaseMeta[] | null>(null)
  const [local, setLocal] = useState<SavedCaseMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'updated', desc: true })
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState<string | null>(null)

  /** Latest load: a slower reply from before a sign-in or sign-out is dropped */
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setError(null)
    try {
      const [mine, browser] = await Promise.all([listCases(), listBrowserCases().catch(() => [])])
      if (seq !== loadSeq.current) return
      setCases(mine)
      // Signed in: browser-only cases are offered for moving into the account
      setLocal(address ? browser.filter(b => !mine.some(m => m.id === b.id)) : [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(e instanceof Error ? e.message : 'Could not load your cases')
      setCases([])
    }
  }, [address])

  useEffect(() => {
    if (address !== undefined) load()
  }, [address, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (cases ?? []).filter(c => !q || c.name.toLowerCase().includes(q) || c.origin.address.toLowerCase().includes(q))
    const val = (c: SavedCaseMeta) => (sort.key === 'name' ? c.name.toLowerCase() : sort.key === 'created' ? c.createdAt ?? c.savedAt : c.savedAt)
    return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (sort.desc ? -1 : 1))
  }, [cases, query, sort])

  const remove = async (c: SavedCaseMeta) => {
    if (!confirm(`Delete the case “${c.name}”? This can't be undone.`)) return
    try {
      await deleteCase(c.id)
      setCases(prev => prev?.filter(x => x.id !== c.id) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the case')
    }
  }

  const move = async (c: SavedCaseMeta) => {
    setMoving(c.id)
    try {
      await moveBrowserCaseToAccount(c.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move the case')
    } finally {
      setMoving(null)
    }
  }

  const header = (key: SortKey, label: string) => (
    <button onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg">
      {label} <span className="text-faint">{sort.key === key ? (sort.desc ? '↓' : '↑') : '↕'}</span>
    </button>
  )

  return (
    <div className="min-h-screen flex flex-col">
      <SiteNav />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-10 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-light tracking-tight text-fg">{address ? 'My cases' : 'Cases in this browser'}</h1>
            {address && <p className="text-xs text-faint mt-1">Saved to your account <span className="font-mono">{truncate(address, 6)}</span>. They open on any device you sign in on.</p>}
          </div>
          <button onClick={() => setCreating(v => !v)} className="inline-flex items-center gap-1.5 h-10 px-5 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg">
            <Plus size={15} /> New
          </button>
        </div>

        {creating && (
          <div className="border border-line p-4 space-y-2 bg-panel">
            <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Start a case from an address or transaction</div>
            <SearchForm />
          </div>
        )}

        {address === null && (
          <div className="border border-accent/40 p-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted flex-1 min-w-[240px]">These cases live only in this browser. Sign in with a wallet or email to keep them in your account.</span>
            <button onClick={() => signIn('/cases')} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
              <Wallet size={13} /> {busy ? 'Check your wallet…' : 'Sign in'}
            </button>
            {authError && <span className="w-full text-xs text-red-500">{authError}</span>}
          </div>
        )}

        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cases…" aria-label="Search cases"
            className="w-full h-10 pl-9 pr-3 text-sm bg-bg border border-line text-fg placeholder:text-faint outline-none focus:border-accent" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="border border-line overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="text-left font-medium px-4 py-3">{header('name', 'Name')}</th>
                <th className="text-left font-medium py-3">Started from</th>
                <th className="text-left font-medium py-3">Addresses</th>
                <th className="text-left font-medium py-3">{header('created', 'Date created')}</th>
                <th className="text-left font-medium py-3">{header('updated', 'Last update')}</th>
                <th className="text-right font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {cases === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-faint">Loading…</td></tr>}
              {cases?.length === 0 && !error && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-faint">No cases yet. Press <b className="text-fg font-medium">New</b>, trace something and press <b className="text-fg font-medium">Save case</b>.</td></tr>
              )}
              {shown.map(c => (
                <tr key={c.id} className="border-b border-line/60 hover:bg-panel">
                  <td className="px-4 py-3">
                    <Link href={`/trace?case=${encodeURIComponent(c.id)}`} className="text-accent hover:underline font-medium">{c.name}</Link>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <span className={`w-1.5 h-1.5 rounded-full ${chainDot(c.origin.chain)}`} />
                      <span className="uppercase text-[10px] text-faint">{c.origin.chain}{c.originKind === 'tx' ? ' tx' : ''}</span>
                      <span className="font-mono text-xs">{truncate(c.origin.address, 6)}</span>
                    </span>
                  </td>
                  <td className="py-3 text-muted">{c.addresses}</td>
                  <td className="py-3 text-muted whitespace-nowrap">{when(c.createdAt ?? c.savedAt)}</td>
                  <td className="py-3 text-muted whitespace-nowrap">{when(c.savedAt)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/trace?case=${encodeURIComponent(c.id)}`} title="Open" aria-label={`Open ${c.name}`} className="inline-grid place-items-center w-8 h-8 text-muted hover:text-fg">
                      <ExternalLink size={14} />
                    </Link>
                    <button onClick={() => remove(c)} title="Delete" aria-label={`Delete ${c.name}`} className="inline-grid place-items-center w-8 h-8 text-faint hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {local.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Still only in this browser</div>
            <ul className="border border-line divide-y divide-line">
              {local.map(c => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`w-1.5 h-1.5 rounded-full ${chainDot(c.origin.chain)}`} />
                  <span className="text-fg flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-faint">{when(c.savedAt)}</span>
                  <button onClick={() => move(c)} disabled={!!moving} className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-raised hover:bg-line text-fg disabled:opacity-50">
                    <Upload size={12} /> {moving === c.id ? 'Moving…' : 'Move to my account'}
                  </button>
                  <button onClick={async () => { if (confirm(`Delete “${c.name}” from this browser?`)) { await deleteBrowserCase(c.id); setLocal(l => l.filter(x => x.id !== c.id)) } }}
                    title="Delete" aria-label={`Delete ${c.name}`} className="p-1 text-faint hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}
