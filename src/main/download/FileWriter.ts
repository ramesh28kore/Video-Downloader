import { open, type FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'

/**
 * Owns the single open file handle for one download's `.part` file.
 *
 * Design goals (spec §large-file support):
 *   - Never buffer the whole file. Segments write directly to their byte offset
 *     with `filehandle.write(buffer, 0, len, position)` — random access, no
 *     read-modify-write, no final "assembly" pass that would need 2x disk.
 *   - Optional sparse preallocation via ftruncate so NTFS reserves the size and
 *     the total is knowable before the first byte lands.
 *   - fsync only at completion (not per chunk) to avoid thrashing the disk.
 */
export class FileWriter {
  private handle: FileHandle | null = null
  private closed = false

  constructor(
    private readonly path: string,
    private readonly preallocate = true
  ) {}

  async open(expectedSize: number | null): Promise<void> {
    if (this.handle) return
    // 'w+' truncates/creates; but for resume we must NOT truncate. We use 'r+'
    // when the file already exists (resume) and 'w+' when creating fresh.
    try {
      this.handle = await open(this.path, constants.O_RDWR | constants.O_CREAT, 0o644)
    } catch (err) {
      throw err
    }
    if (this.preallocate && expectedSize != null && expectedSize > 0) {
      const { size } = await this.handle.stat()
      if (size < expectedSize) {
        // Sparse extend — cheap on NTFS; a no-op-ish metadata update if the
        // filesystem does not support sparse files.
        try {
          await this.handle.truncate(expectedSize)
        } catch {
          /* preallocation is best-effort; writes still work without it */
        }
      }
    }
  }

  /** Random-access write at an absolute byte offset. */
  async writeAt(buffer: Buffer, position: number): Promise<number> {
    if (!this.handle) throw new Error('FileWriter not open')
    let written = 0
    while (written < buffer.length) {
      const res = await this.handle.write(
        buffer,
        written,
        buffer.length - written,
        position + written
      )
      if (res.bytesWritten === 0) {
        throw new Error(`Short write: 0 bytes advanced at offset ${position + written}`)
      }
      written += res.bytesWritten
    }
    return written
  }

  /** Shrink the file to the true total (drops any sparse preallocation slack). */
  async truncateTo(size: number): Promise<void> {
    if (!this.handle) return
    await this.handle.truncate(size)
  }

  async currentSize(): Promise<number> {
    if (!this.handle) return 0
    const { size } = await this.handle.stat()
    return size
  }

  async sync(): Promise<void> {
    if (!this.handle) return
    await this.handle.sync()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.handle) {
      try {
        await this.handle.sync()
      } catch {
        /* file may already be gone */
      }
      await this.handle.close()
      this.handle = null
    }
  }
}
