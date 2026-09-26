'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http, useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { base, baseSepolia, mainnet, sepolia } from 'wagmi/chains'
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { base as akBase, baseSepolia as akBaseSepolia, mainnet as akMainnet, sepolia as akSepolia, type AppKitNetwork } from '@reown/appkit/networks'
import { createSiweMessage } from 'viem/siwe'
import { setCaseAccount } from '@/lib/saved-cases'
import { SettingsProvider } from './Settings'

// Sign-in with a wallet or an email (Reown AppKit, formerly WalletConnect). An email
// sign-in gets a wallet from Reown, so every account is a wallet address: the site
// stores no emails. After connecting, the user signs a free message (Sign-In with
// Ethereum) and the server sets a session cookie.

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID
export const walletSignInEnabled = !!projectId

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://ashiato-six.vercel.app'

// Real networks only, so a wallet is never nudged onto a test network; payments test mode adds the test ones
const testnets = process.env.NEXT_PUBLIC_PAYMENTS_TESTNET === '1'
const networks: [AppKitNetwork, ...AppKitNetwork[]] = testnets ? [akMainnet, akBase, akBaseSepolia, akSepolia] : [akMainnet, akBase]
const adapter = projectId ? new WagmiAdapter({ networks, projectId, ssr: true }) : null
const modal = adapter && projectId
  ? createAppKit({
      adapters: [adapter],
      networks,
      defaultNetwork: akMainnet,
      projectId,
      metadata: { name: 'Ashiato', description: 'Open, community-verified crypto tracing', url: siteUrl, icons: [`${siteUrl}/icon-512.png`] },
      features: { email: true, socials: ['google', 'github', 'x', 'apple', 'discord'], emailShowWallets: true, analytics: false },
      themeMode: 'dark',
      themeVariables: { '--w3m-accent': '#5b5bf0', '--w3m-border-radius-master': '1px' },
    })
  : null

// Without a project ID the app still works (signed out); wagmi just has nothing to connect
const fallbackConfig = testnets
  ? createConfig({ chains: [mainnet, base, baseSepolia, sepolia], transports: { [mainnet.id]: http(), [base.id]: http(), [baseSepolia.id]: http(), [sepolia.id]: http() }, ssr: true })
  : createConfig({ chains: [mainnet, base], transports: { [mainnet.id]: http(), [base.id]: http() }, ssr: true })
const wagmiConfig = adapter?.wagmiConfig ?? fallbackConfig
const queryClient = new QueryClient()

interface Auth {
  /** Signed-in wallet address (lowercase), null when signed out, undefined while checking */
  address: string | null | undefined
  busy: boolean
  error: string | null
  enabled: boolean
  /** Opens the sign-in modal; after signing, goes to `then` (e.g. /cases), or stays on the page */
  signIn: (then?: string) => void
  signOut: () => Promise<void>
  /** Opens the wallet window: balances, or adding funds (buy with a card, or receive) */
  openWallet: (view?: 'Account' | 'OnRampProviders') => void
}

const AuthContext = createContext<Auth>({
  address: undefined, busy: false, error: null, enabled: false, signIn: () => {}, signOut: async () => {}, openWallet: () => {},
})
export const useAuth = () => useContext(AuthContext)

function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { address: wallet, isConnected, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const [address, setAddress] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set when the user asked to sign in; where to go afterwards */
  const pending = useRef<string | null>(null)
  const signing = useRef(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(b => setAddress(b.address ?? null))
      .catch(() => setAddress(null))
  }, [])
  useEffect(() => {
    if (address !== undefined) setCaseAccount(address)
  }, [address])

  const siwe = useCallback(async (who: `0x${string}`, then: string) => {
    if (signing.current) return
    signing.current = true
    setBusy(true)
    setError(null)
    try {
      const { nonce } = await fetch('/api/auth/nonce').then(r => r.json())
      const message = createSiweMessage({
        domain: window.location.host,
        address: who,
        statement: 'Sign in to Ashiato. This is free: it does not send a transaction or give access to your funds.',
        uri: window.location.origin,
        version: '1',
        chainId: chainId ?? 1,
        nonce,
        issuedAt: new Date(),
      })
      const signature = await signMessageAsync({ message })
      const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Sign-in failed')
      setAddress(body.address)
      modal?.close()
      if (then) router.push(then)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed'
      setError(/reject|denied|cancel/i.test(msg) ? 'Sign-in cancelled' : msg.split('\n')[0])
      await disconnectAsync().catch(() => {})
    } finally {
      signing.current = false
      setBusy(false)
    }
  }, [chainId, signMessageAsync, disconnectAsync, router])

  // Once the wallet (or email wallet) is connected after the user asked to sign in, ask for the signature
  useEffect(() => {
    if (pending.current === null || !isConnected || !wallet) return
    const then = pending.current
    pending.current = null
    siwe(wallet, then)
  }, [isConnected, wallet, siwe])

  const signIn = useCallback((then = '') => {
    setError(null)
    if (!modal) {
      setError('Sign-in is not set up on this server (NEXT_PUBLIC_REOWN_PROJECT_ID)')
      return
    }
    if (isConnected && wallet) {
      siwe(wallet, then)
      return
    }
    pending.current = then
    modal.open({ view: 'Connect' })
  }, [isConnected, wallet, siwe])

  // Not connected (e.g. after a reload): connect first; an email wallet asks for the same email again
  const openWallet = useCallback((view: 'Account' | 'OnRampProviders' = 'Account') => {
    modal?.open({ view: isConnected ? view : 'Connect' })
  }, [isConnected])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    await disconnectAsync().catch(() => {})
    setAddress(null)
    router.push('/')
  }, [disconnectAsync, router])

  return (
    <AuthContext.Provider value={{ address, busy, error, enabled: !!modal, signIn, signOut, openWallet }}>
      {children}
    </AuthContext.Provider>
  )
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider><SettingsProvider>{children}</SettingsProvider></AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
