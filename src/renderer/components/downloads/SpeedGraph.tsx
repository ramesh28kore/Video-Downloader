import { memo } from 'react'
import { useDownloads } from '../../stores/downloads'
import { formatSpeed } from '@shared/format'

/** Lightweight SVG sparkline of global throughput (spec: speed graph). */
function SpeedGraphBase({ height = 46 }: { height?: number }): React.JSX.Element {
  const samples = useDownloads((s) => s.speedSamples)
  const max = Math.max(1, ...samples)
  const w = 240
  const step = samples.length > 1 ? w / (samples.length - 1) : w
  const points = samples.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`)
  const path = points.length ? `M${points.join(' L')}` : ''
  const area = points.length ? `${path} L${((samples.length - 1) * step).toFixed(1)},${height} L0,${height} Z` : ''
  const current = samples[samples.length - 1] ?? 0

  return (
    <div className="flex items-end gap-2" data-testid="speed-graph" title={`Current: ${formatSpeed(current)}`}>
      <svg width={w} height={height} className="overflow-visible">
        <defs>
          <linearGradient id="speedfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#speedfill)" />}
        {path && <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.6" />}
      </svg>
      <span className="w-20 text-right text-[12px] font-semibold tabular-nums text-accent">{formatSpeed(current)}</span>
    </div>
  )
}

export const SpeedGraph = memo(SpeedGraphBase)
