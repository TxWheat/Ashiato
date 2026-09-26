'use client'

import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ExternalLink, ShieldAlert } from 'lucide-react'
import { erc20Abi, formatEther, parseUnits } from 'viem'
import { useAccount, useConfig, useSwitchChain, useWriteContract } from 'wagmi'
import { estimateFeesPerGas, getBalance, readContract, waitForTransactionReceipt } from 'wagmi/actions'
import SiteNav from '@/components/SiteNav'
import { useAuth } from '@/components/Providers'
import { PAY_CHAINS, PayChain, PRO_PLANS, TEST_USDC_FAUCET, USDC_DECIMALS } from '@/lib/billing/plans'

interface Billing {
  payTo: string | null
  testMode: boolean
  networks: PayChain[]
  pro: boolean
  expiresAt: string | null
  payments: { id: string; method: string; amount: number; currency: string; months: number; paidAt: string }[]
  error?: string
}

const FREE = [
  'Trace Bitcoin, Ethereum and Tron',
  'Follow funds across bridges',
  'Scam, sanctions and exchange labels',
  'Community labels and votes',
  'Save cases to your account',
  'PDF report, CSV and GraphML exports',
]
const PRO = [
  'Everything in Free',
  'Supports the data that keeps tracing free',
  'Watch alerts when funds move (coming soon)',
  'Plain-English trace summary for police reports (coming soon)',
  'More chains: Base, Arbitrum, BNB and more (coming soon)',
]

const day = (iso: string) => new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
const perMonth = (p: (typeof PRO_PLANS)[number]) => (p.usdc / p.months).toFixed(2).replace(/\.00$/, '')

export default function PricingPage() {
  const { address, signIn, busy: signingIn } = useAuth()
  const [billing, setBilling] = useState<Billing | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/billing').catch(() => null)
    setBilling(res?.ok ? await res.json() : null)
  }, [])
  useEffect(() => { if (address) load() }, [address, load])

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <SiteNav />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-10 py-10 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-tight text-fg">Pricing</h1>
          <p className="text-sm text-muted max-w-2xl">
            Tracing is free, and everything a scam victim needs stays free. Pro is for investigators who use Ashiato often,
            and pays for the blockchain data that keeps the free version running.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Plan title="Free" price="US$0" note="forever" items={FREE} />
          <Plan title="Pro" price={`US$${PRO_PLANS[0].usdc}`} note="a month, or less when you pay for longer" items={PRO} highlight>
            <p className="text-[11px] text-faint">
              {PRO_PLANS.map(p => `${p.months} month${p.months > 1 ? 's' : ''}: ${p.usdc} USDC`).join(' · ')}
            </p>
          </Plan>
        </div>

        <section className="border border-line p-5 space-y-4">
          <h2 className="text-sm font-medium text-fg">Get Pro</h2>
          {address === undefined ? (
            <p className="text-xs text-faint">Loading…</p>
          ) : !address ? (
            <button onClick={() => signIn()} disabled={signingIn}
              className="h-10 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
              {signingIn ? 'Signing in…' : 'Sign in to upgrade'}
            </button>
          ) : !billing ? (
            <p className="text-xs text-faint">Loading your plan…</p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {billing.pro && billing.expiresAt
                  ? <>You have <span className="text-fg font-medium">Pro until {day(billing.expiresAt)}</span>. Paying again adds time on top.</>
                  : <>You&apos;re on the <span className="text-fg font-medium">Free</span> plan.</>}
              </p>
              {billing.testMode && (
                <p className="text-xs border border-amber-500/50 bg-amber-500/10 text-fg px-3 py-2">
                  Test mode: pay with free test USDC on a test network, no real money. Get test USDC at{' '}
                  <a href={TEST_USDC_FAUCET} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">faucet.circle.com</a>
                  {' '}(pick Base Sepolia), plus a little Base Sepolia test ETH for the fee.
                </p>
              )}
              {billing.payTo && billing.networks.length > 0
                ? <PayWithUsdc payTo={billing.payTo} account={address} networks={billing.networks} onPaid={load} />
                : <p className="text-xs text-faint">Payments open soon.</p>}
              {billing.payments.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-[10px] font-medium uppercase tracking-wider text-faint">Your payments</h3>
                  <ul className="text-xs text-muted space-y-0.5">
                    {billing.payments.map(p => {
                      const [chain, hash] = p.id.split(':') as [PayChain, string]
                      return (
                        <li key={p.id} className="flex items-center gap-2">
                          <span>{day(p.paidAt)}</span>
                          <span className="text-fg">{p.amount} {p.currency}</span>
                          <span>· {p.months} month{p.months > 1 ? 's' : ''}</span>
                          {PAY_CHAINS[chain] && (
                            <a href={PAY_CHAINS[chain].tx + hash} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-fg" aria-label="View the transaction">
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <p className="flex gap-2 text-xs text-muted max-w-2xl">
          <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-500" />
          <span>
            Ashiato traces where money went. It never recovers funds, never charges a fee to get money back, and never
            contacts you first. Anyone offering to recover your crypto for a fee is almost certainly running a second scam.
            Only pay from this page, while signed in.
          </span>
        </p>
      </main>
    </div>
  )
}

function Plan({ title, price, note, items, highlight, children }: {
  title: string; price: string; note: string; items: string[]; highlight?: boolean; children?: React.ReactNode
}) {
  return (
    <div className={clsx('border p-5 space-y-3', highlight ? 'border-accent' : 'border-line')}>
      <div className="text-sm font-medium text-fg">{title}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-light text-fg">{price}</span>
        <span className="text-xs text-faint">{note}</span>
      </div>
      <ul className="space-y-1.5 text-xs text-muted">
        {items.map(i => <li key={i} className="flex gap-2"><Check size={13} className="shrink-0 text-accent mt-px" />{i}</li>)}
      </ul>
      {children}
    </div>
  )
}

/**
 * The useful part of a wallet error. viem wraps the wallet's own reason ("unknown error
 * occurred while executing…"), so look through the causes for the specific one.
 */
function walletError(e: unknown): string {
  const parts: string[] = []
  for (let c: unknown = e, i = 0; c && i < 6; c = (c as { cause?: unknown }).cause, i++) {
    const x = c as { shortMessage?: string; details?: string; message?: string }
    for (const t of [x.details, x.shortMessage, x.message?.split('\n')[0]]) if (t && !parts.includes(t)) parts.push(t)
  }
  const specific = parts.filter(p => !/unknown error|an error occurred/i.test(p))
  return (specific[0] ?? parts[0] ?? 'Payment failed').slice(0, 300)
}

/** Pays with the connected wallet, then asks the server to credit it */
function PayWithUsdc({ payTo, account, networks, onPaid }: { payTo: string; account: string; networks: PayChain[]; onPaid: () => void }) {
  const [plan, setPlan] = useState(0)
  const { address: wallet, chainId } = useAccount()
  // Start on the network the wallet is already on, when payments are taken there
  const [chain, setChain] = useState<PayChain>(() => networks.find(k => PAY_CHAINS[k].id === chainId) ?? networks[0])
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const [working, setWorking] = useState(false)
  const [hash, setHash] = useState('')
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const config = useConfig()
  const { signIn, openWallet } = useAuth()
  const net = PAY_CHAINS[chain]
  const price = PRO_PLANS[plan]
  const sameWallet = wallet?.toLowerCase() === account

  /** The server checks the payment on-chain; it may need a few more blocks first */
  const claim = async (chainKey: PayChain, txHash: string) => {
    for (let i = 0; i < 20; i++) {
      const res = await fetch('/api/billing/usdc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: chainKey, txHash }) })
      const body = await res.json().catch(() => ({}))
      if (res.ok && !body.retry) {
        setStatus({ text: body.expiresAt ? `Done: Pro until ${day(body.expiresAt)}. Thank you!` : 'Payment recorded.' })
        onPaid()
        return
      }
      if (!body.retry) throw new Error(body.error ?? 'Could not check the payment')
      setStatus({ text: `${body.error ?? 'Checking'}… this can take a minute.` })
      await new Promise(r => setTimeout(r, 6000))
    }
    throw new Error('Still not confirmed. Paste the transaction hash below in a few minutes.')
  }

  const pay = async () => {
    setWorking(true)
    setStatus(null)
    try {
      if (chainId !== net.id) await switchChainAsync({ chainId: net.id })
      // Say plainly what's missing, rather than the wallet's generic "unknown error"
      const amount = parseUnits(String(price.usdc), USDC_DECIMALS)
      const [usdcHeld, ethHeld] = await Promise.all([
        readContract(config, { address: net.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [wallet!], chainId: net.id }),
        getBalance(config, { address: wallet!, chainId: net.id }).then(b => b.value),
      ])
      const test = net.test ? 'test ' : ''
      if (usdcHeld < amount) throw new Error(`This wallet has ${Number(usdcHeld) / 10 ** USDC_DECIMALS} ${test}USDC on ${net.name}; ${price.usdc} is needed${net.test ? ' (free at faucet.circle.com)' : ''}`)
      // A USDC transfer uses about 65k gas (more for a smart-contract wallet): allow 100k at today's fee
      const fees = await estimateFeesPerGas(config, { chainId: net.id }).catch(() => null)
      const needed = fees?.maxFeePerGas ? 100_000n * fees.maxFeePerGas : 1n
      if (ethHeld < needed) {
        const eth = (v: bigint) => Number(formatEther(v)).toPrecision(2)
        throw new Error(`The network fee on ${net.name} is about ${eth(needed)} ${test}ETH, and this wallet has ${eth(ethHeld)} ${test}ETH. Add a little ${net.name} ETH${chain === 'eth' ? ', or pay on Base instead (fees under 1¢)' : ''}`)
      }
      setStatus({ text: 'Confirm the payment in your wallet…' })
      const tx = await writeContractAsync({
        address: net.usdc, abi: erc20Abi, functionName: 'transfer',
        args: [payTo as `0x${string}`, amount], chainId: net.id,
      })
      setHash(tx)
      setStatus({ text: 'Sent. Waiting for the network…' })
      await waitForTransactionReceipt(config, { hash: tx, chainId: net.id })
      await claim(chain, tx)
    } catch (e) {
      console.error('Payment failed', e)
      const msg = walletError(e)
      setStatus({ text: /reject|denied|cancel/i.test(msg) ? 'Cancelled in your wallet' : /exceeds balance|insufficient/i.test(msg) ? `Not enough USDC (or ${net.name} ETH for the fee) in this wallet` : msg, error: true })
    } finally {
      setWorking(false)
    }
  }

  const check = async () => {
    setWorking(true)
    try {
      await claim(chain, hash.trim())
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : 'Could not check the payment', error: true })
    } finally {
      setWorking(false)
    }
  }

  const pill = (on: boolean) => clsx('h-9 px-3 text-xs border', on ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How long">
        {PRO_PLANS.map((p, i) => (
          <button key={p.months} role="radio" aria-checked={plan === i} onClick={() => setPlan(i)} className={pill(plan === i)}>
            {p.months} month{p.months > 1 ? 's' : ''} · <span className="font-mono">{p.usdc} USDC</span>
            {p.months > 1 && <span className="text-faint"> ({perMonth(p)}/mo)</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Network">
        {networks.map(k => (
          <button key={k} role="radio" aria-checked={chain === k} onClick={() => setChain(k)} className={pill(chain === k)}>
            {PAY_CHAINS[k].name}{k.startsWith('base') && <span className="text-faint"> · fee under 1¢</span>}
          </button>
        ))}
      </div>
      {!wallet ? (
        <button onClick={() => signIn()} className="h-10 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg">Connect your wallet</button>
      ) : !sameWallet ? (
        <p className="text-xs text-red-500">Your connected wallet isn&apos;t the one you signed in with. Pay from the signed-in wallet so the payment is credited to your account.</p>
      ) : (
        <button onClick={pay} disabled={working} className="h-10 px-4 text-sm font-medium bg-accent hover:bg-accent-hover text-accent-fg disabled:opacity-50">
          {working ? 'Working…' : `Pay ${price.usdc} USDC on ${net.name}`}
        </button>
      )}
      <p className="text-[11px] text-faint">
        No USDC yet? <button onClick={() => openWallet('OnRampProviders')} className="underline underline-offset-2 hover:text-fg">Add funds</button> (buy with a card, or use My wallet → Receive to send it from an exchange).{' '}
        Sent straight to Ashiato&apos;s wallet <span className="font-mono">{payTo}</span>. You also need a little {net.name} {net.test ? 'test ' : ''}ETH for the network fee.
      </p>
      {status && (
        <p className={clsx('text-xs', status.error ? 'text-red-500' : 'text-muted')}>
          {status.text}
          {status.error && /USDC on|network fee/.test(status.text) && (
            <> <button onClick={() => openWallet('OnRampProviders')} className="underline underline-offset-2 hover:text-fg">Add funds</button></>
          )}
        </p>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer hover:text-fg">Already paid? Check a transaction</summary>
        <div className="mt-2 flex gap-2 max-w-xl">
          <input value={hash} onChange={e => setHash(e.target.value)} placeholder={`${net.name} transaction hash (0x…)`} aria-label="Transaction hash"
            className="flex-1 h-9 px-3 bg-panel border border-line focus:border-accent font-mono text-xs text-fg outline-none" />
          <button onClick={check} disabled={working || !/^0x[0-9a-fA-F]{64}$/.test(hash.trim())}
            className="h-9 px-3 text-xs font-medium bg-raised hover:bg-line text-fg disabled:opacity-40">Check</button>
        </div>
      </details>
    </div>
  )
}
