import type { DownloadTask } from '../download/DownloadTask'
import type { DownloadStatus } from '@shared/types'

/**
 * Decides which queued downloads may run, respecting max concurrency and the
 * user's manual queue order. It holds no state of its own — it reads the live
 * task map owned by DownloadManager.
 */
export class QueueManager {
  maxConcurrent = 3

  constructor(private getTasks: () => Map<string, DownloadTask>) {}

  activeCount(): number {
    let n = 0
    for (const t of this.getTasks().values()) {
      if (t.status === 'downloading' || t.status === 'connecting' || t.status === 'retrying') n++
    }
    return n
  }

  queuedCount(): number {
    let n = 0
    for (const t of this.getTasks().values()) if (t.status === 'queued' || t.status === 'waiting') n++
    return n
  }

  /** Ordered queued task ids (lowest queuePos first). */
  queuedOrder(): DownloadTask[] {
    return [...this.getTasks().values()]
      .filter((t) => t.status === 'queued' || t.status === 'waiting')
      .sort((a, b) => a.queuePos - b.queuePos)
  }

  /**
   * Return the queued tasks that should be started now to fill free slots.
   * Does not mutate — the manager starts them.
   */
  nextToStart(): DownloadTask[] {
    const free = Math.max(0, this.maxConcurrent - this.activeCount())
    if (free === 0) return []
    return this.queuedOrder().slice(0, free)
  }

  /** Move a task to a new position in the queue (drag-drop reorder). */
  reorder(orderedIds: string[]): Map<string, number> {
    const pos = new Map<string, number>()
    orderedIds.forEach((id, i) => pos.set(id, i + 1))
    return pos
  }
}

export function isTerminal(status: DownloadStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
