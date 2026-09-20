import { memo } from 'react'
import type { DownloadStatus } from '@shared/types'
import { cn } from '../../lib/cn'

const LABEL: Record<DownloadStatus, string> = {
  idle: 'Idle',
  queued: 'Queued',
  connecting: 'Connecting',
  downloading: 'Downloading',
  paused: 'Paused',
  waiting: 'Waiting',
  retrying: 'Retrying',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

const STYLE: Record<DownloadStatus, string> = {
  idle: 'bg-panel2 text-muted',
  queued: 'bg-accent/15 text-accent',
  connecting: 'bg-accent/15 text-accent',
  downloading: 'bg-accent/15 text-accent',
  paused: 'bg-warn/15 text-warn',
  waiting: 'bg-warn/15 text-warn',
  retrying: 'bg-warn/15 text-warn',
  completed: 'bg-ok/15 text-ok',
  failed: 'bg-err/15 text-err',
  cancelled: 'bg-panel2 text-muted'
}

export const StatusBadge = memo(function StatusBadge({ status }: { status: DownloadStatus }): React.JSX.Element {
  return (
    <span className={cn('chip whitespace-nowrap', STYLE[status])} data-testid={`status-${status}`}>
      {LABEL[status]}
    </span>
  )
})
