import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Payments test mode also decides which networks the wallet is offered (test networks only in test mode)
  env: { NEXT_PUBLIC_PAYMENTS_TESTNET: process.env.PAYMENTS_TESTNET === '1' ? '1' : '' },
  // Label files are read from disk at runtime by lib/labels.ts
  outputFileTracingIncludes: {
    '/api/**': ['./data/labels/**'],
  },
  // Optional Node / React Native deps of the wallet libraries (WalletConnect, MetaMask SDK):
  // never used in the browser, so leave them out instead of warning (as Reown's docs advise)
  webpack: config => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    config.resolve.fallback = { ...config.resolve.fallback, '@react-native-async-storage/async-storage': false }
    return config
  },
}

export default nextConfig
