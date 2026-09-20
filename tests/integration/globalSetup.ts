/**
 * Vitest global setup for the integration project: boots ONE shared test
 * server for all integration files (they run serially — fileParallelism is
 * off) and exposes its URL through provide/inject.
 */
import { startTestServer } from '../../test-server/server'
import type { TestProject } from 'vitest/node'

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const handle = await startTestServer({ port: 0 })
  project.provide('testServerUrl', handle.url(''))
  return async () => {
    await handle.close()
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    testServerUrl: string
  }
}
