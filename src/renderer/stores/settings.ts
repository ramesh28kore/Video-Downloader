import { create } from 'zustand'
import type { AppSettings, ThemeMode } from '@shared/types'

interface SettingsState {
  settings: AppSettings | null
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
  setFromEvent: (s: AppSettings) => void
}

export function applyTheme(theme: ThemeMode | undefined): void {
  const root = document.documentElement
  let resolved: 'light' | 'dark' = 'light'
  if (theme === 'dark') resolved = 'dark'
  else if (theme === 'system') resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  root.dataset.theme = resolved
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,
  load: async () => {
    const s = await window.turbo.settings.get()
    applyTheme(s.theme)
    set({ settings: s, loaded: true })
  },
  update: async (patch) => {
    const s = await window.turbo.settings.update(patch)
    applyTheme(s.theme)
    set({ settings: s })
  },
  setFromEvent: (s) => {
    applyTheme(s.theme)
    set({ settings: s })
    if (!get().loaded) set({ loaded: true })
  }
}))
