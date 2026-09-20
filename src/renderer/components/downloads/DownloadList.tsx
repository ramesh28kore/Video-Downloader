import { useRef, memo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useDownloads } from '../../stores/downloads'
import { DownloadRow } from './DownloadRow'
import { Inbox } from 'lucide-react'

const ROW_HEIGHT = 56

/**
 * Virtualized download table — handles 1000+ rows cheaply.
 * Pass the already-filtered list of ids to display.
 */
function DownloadListBase({ ids }: { ids: string[] }): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const records = useDownloads((s) => s.records)
  const selectedId = useDownloads((s) => s.selectedId)
  const openAddDialog = useDownloads((s) => s.openAddDialog)

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  if (ids.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted" data-testid="empty-state">
        <Inbox size={44} strokeWidth={1.2} />
        <div className="text-[15px] font-semibold">No downloads to show</div>
        <div className="text-[12px]">Paste a URL (Ctrl+V) or press Add URL to start.</div>
        <button className="btn btn-primary mt-2" onClick={() => openAddDialog(null)}>
          + Add a download
        </button>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto" data-testid="download-list">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const id = ids[vi.index]
          if (!id) return null
          const rec = records[id]
          if (!rec) return null
          return (
            <DownloadRow
              key={id}
              record={rec}
              selected={selectedId === id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${vi.size}px`,
                transform: `translateY(${vi.start}px)`
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

export const DownloadList = memo(DownloadListBase)
