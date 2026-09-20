import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { sleep } from '../download/Throttle'

/**
 * Filesystem helpers for finalising downloads and managing .part files.
 */
export class FileManager {
  async ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true })
  }

  /** Lowercase names currently present in `dir` (for duplicate detection). */
  async listNames(dir: string): Promise<Set<string>> {
    try {
      const entries = await fsp.readdir(dir)
      return new Set(entries.map((e) => e.toLowerCase()))
    } catch {
      return new Set()
    }
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fsp.access(p)
      return true
    } catch {
      return false
    }
  }

  async size(p: string): Promise<number> {
    const st = await fsp.stat(p)
    return st.size
  }

  /**
   * Rename `.part` -> final path with Windows-lock retries. EBUSY/EPERM happen
   * when antivirus or Explorer briefly holds the new file; retry, then give a
   * clear error. Never clobbers silently — caller decides replace vs rename.
   */
  async finalizeRename(partPath: string, finalPath: string, replace: boolean): Promise<void> {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (replace) {
          await fsp.rm(finalPath, { force: true })
        } else if (await this.exists(finalPath)) {
          // Caller should have resolved duplicates beforehand; be defensive.
          const { base, ext } = splitExt(finalPath)
          finalPath = `${base} (conflict-${Date.now()})${ext}`
        }
        await fsp.rename(partPath, finalPath)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if ((code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') && attempt < maxAttempts - 1) {
          await sleep(500 * (attempt + 1))
          continue
        }
        throw err
      }
    }
  }

  async removeIfExists(p: string): Promise<void> {
    await fsp.rm(p, { force: true })
  }
}

function splitExt(p: string): { base: string; ext: string } {
  const ext = path.extname(p)
  return { base: ext ? p.slice(0, -ext.length) : p, ext }
}
