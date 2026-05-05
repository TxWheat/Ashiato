'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { detectChain } from '@/lib/detect-chain'
import { Search, AlertCircle, Github } from 'lucide-react'

export default function Home() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  const chain = detectChain(address)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chain) {
      setError('Enter a valid BTC or ETH address')
      return
    }
    setError('')
    router.push(`/trace?address=${encodeURIComponent(address.trim())}&chain=${chain}`)
  }

  return (
    <div className="min-h-screen bg-[#020817] flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-slate-900">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="text-sm font-semibold text-white">CryptoTracer</span>
        </div>
        <a
          href="https://github.com/TxWheat/Cryptocurrency-Tracing-Tool"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <Github size={14} />
          Open source
        </a>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="w-full max-w-xl">
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full border border-slate-800 bg-slate-900/50">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[11px] text-slate-400 uppercase tracking-widest font-mono">
                Free · No sign-up · Open source
              </span>
            </div>

            <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
              Trace the money.
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Follow BTC and ETH transactions hop by hop.
              <br />
              Built for scam victims and independent investigators.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none">
                <Search size={17} />
              </div>
              <input
                type="text"
                value={address}
                onChange={e => {
                  setAddress(e.target.value)
                  setError('')
                }}
                placeholder="Enter a BTC or ETH address..."
                className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-xl pl-11 pr-24 py-4 text-white placeholder-slate-700 outline-none transition-colors font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
              />
              {chain && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <span className={`text-[11px] px-2 py-1 rounded-md font-mono uppercase font-bold ${
                    chain === 'btc'
                      ? 'bg-orange-500/20 text-orange-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {chain} detected
                  </span>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-black font-bold py-4 rounded-xl transition-colors text-sm"
            >
              Trace Address
            </button>
          </form>

          <div className="mt-8 grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Bitcoin', sub: 'BTC mainnet', color: 'text-orange-400' },
              { label: 'Ethereum', sub: 'ETH mainnet', color: 'text-blue-400' },
              { label: 'More chains', sub: 'Coming soon', color: 'text-slate-600' },
            ].map(item => (
              <div key={item.label} className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
                <div className={`text-sm font-semibold ${item.color}`}>{item.label}</div>
                <div className="text-xs text-slate-600 mt-0.5">{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
