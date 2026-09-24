'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { SavedCaseMeta, deleteCase, listCases } from '@/lib/saved-cases'
import { truncate } from '@/lib/detect-chain'

/** Charts saved in this browser, newest first */
export default function SavedCharts() {
  const [items, setItems] = useState<SavedCaseMeta[] | null>(null)

  useEffect(() => {
    listCases().then(setItems).catch(() => setItems([]))
  }, [])

  if (!items?.length) return null

  const remove = async (c: SavedCaseMeta) => {
    if (!confirm(`Delete the case “${c.name}”? This can't be undone.`)) return
    await deleteCase(c.id)
    setItems(items.filter(x => x.id !== c.id))
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Your cases</div>
      <ul className="border border-line divide-y divide-line max-h-56 overflow-y-auto bg-bg/60">
        {items.map(c => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-panel">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.origin.chain === 'btc' ? 'bg-orange-500' : 'bg-violet-500'}`} />
            <Link href={`/trace?case=${encodeURIComponent(c.id)}`} className="min-w-0 flex-1">
              <div className="text-[13px] text-fg truncate">{c.name}</div>
              <div className="text-[10px] text-faint truncate">
                {c.originKind === 'tx' ? 'tx ' : ''}{truncate(c.origin.address, 6)} · {c.addresses} address{c.addresses === 1 ? '' : 'es'} · {new Date(c.savedAt).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </Link>
            <button onClick={() => remove(c)} title="Delete case" aria-label={`Delete ${c.name}`} className="p-1 text-faint hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
