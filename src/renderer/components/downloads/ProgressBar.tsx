import { memo } from 'react'
import { cn } from '../../lib/cn'

export const ProgressBar = memo(function ProgressBar({
  done,
  total,
  status
}: {
  done: number
  total: number
  status: string
}): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
  const barColor =
    status === 'failed' ? 'bg-err' : status === 'completed' ? 'bg-ok' : status === 'paused' || status === 'cancelled' ? 'bg-warn' : 'bg-accent'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-200', barColor)} style={{ width: `${pct}%` }} />
    </div>
  )
})
