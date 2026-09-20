import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const alias = {
  '@shared': resolve('src/shared'),
  '@renderer': resolve('src/renderer')
}

export default defineConfig({
  resolve: { alias },
  test: {
    // Unit tests run in the plain Node (system) environment — the download
    // engine is pure Node with zero `electron` imports, so it tests directly.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 20000
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          // integration tests spin up the local test server
          globalSetup: ['tests/integration/globalSetup.ts'],
          testTimeout: 120000,
          hookTimeout: 60000,
          // download engine tests touch real sockets + disks; keep them serial
          fileParallelism: false
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
          setupFiles: ['tests/ui/setup.ts'],
          testTimeout: 20000
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'perf',
          environment: 'node',
          include: ['tests/perf/**/*.test.ts'],
          testTimeout: 600000,
          fileParallelism: false
        }
      }
    ]
  }
})
