import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Label files are read from disk at runtime by lib/labels.ts
  outputFileTracingIncludes: {
    '/api/**': ['./data/labels/**'],
  },
}

export default nextConfig
