import { promises as fsp } from 'node:fs'
import path from 'node:path'

/** Bytes of headroom we insist on beyond the declared file size. */
export const DISK_HEADROOM_BYTES = 64 * 1024 * 1024

export interface DiskSpace {
  availableBytes: number
  totalBytes: number
}

/**
 * Available space for the volume containing `filePath`, via fs.promises.statfs
 * (Node >= 19). Falls back to "assume enough" if statfs is unavailable, but
 * real ENOSPC is still handled at write time.
 */
export async function getDiskSpace(filePath: string): Promise<DiskSpace | null> {
  try {
    const dir = path.dirname(path.resolve(filePath))
    const stats = await fsp.statfs(dir)
    return {
      availableBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize
    }
  } catch {
    return null
  }
}

/**
 * True when the volume can hold `neededBytes` plus headroom. Unknown space is
 * treated as OK (write-time ENOSPC remains the backstop).
 */
export async function hasSpaceFor(filePath: string, neededBytes: number): Promise<boolean> {
  const space = await getDiskSpace(filePath)
  if (!space) return true
  if (neededBytes < 0) return true
  return space.availableBytes >= neededBytes + DISK_HEADROOM_BYTES
}
