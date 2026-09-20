import type { TurboApi } from './index'

declare global {
  interface Window {
    /** Preload bridge exposed via contextBridge. */
    turbo: TurboApi
  }
}

export {}
