import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': import.meta.dirname,
      'server-only': path.join(import.meta.dirname, 'tests', 'server-only-stub.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
