/* ── TextStream Statistics Panel ─────────────────────────────────── */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { FrameStats } from "@/lib/text-stream-types"

interface StatsPanelProps {
  stats: FrameStats | null
  compressionRatio: number
  charactersRendered: number
  changedCells: number
  bandwidth: string
  latency: string
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] font-medium text-muted-foreground tracking-wider uppercase">
        {label}
      </span>
      <span className="text-[11px] font-mono tabular-nums text-foreground/80">
        {value}
      </span>
    </div>
  )
}

export function StatsPanel({
  stats,
  compressionRatio,
  charactersRendered,
  changedCells,
  bandwidth,
  latency,
}: StatsPanelProps) {
  const fps = stats?.frame_rate?.toFixed(1) ?? "—"
  const frameTime = stats?.frame_time_ms?.toFixed(1) ?? "—"
  const cellsCount = stats?.cells_count ?? charactersRendered
  const changedCount = stats?.changed_count ?? changedCells
  const ratio = stats?.compression_ratio?.toFixed(1) ?? compressionRatio.toFixed(1)
  const savings = stats
    ? `${Math.round((1 - 1 / stats.compression_ratio) * 100)}%`
    : "—"

  return (
    <Card className="border-0 shadow-none bg-transparent">
      <CardHeader className="px-3 py-2">
        <CardTitle className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
          Statistics
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 py-0 pb-3 space-y-0">
        <StatRow label="FPS" value={fps} />
        <StatRow label="Frame Time" value={`${frameTime}ms`} />
        <StatRow label="Latency" value={latency} />
        <StatRow label="Bandwidth" value={bandwidth} />
        <StatRow label="Cells" value={cellsCount.toLocaleString()} />
        <StatRow label="Changed" value={changedCount.toLocaleString()} />
        <StatRow label="Compression" value={`${ratio}x`} />
        <StatRow label="Savings" value={savings} />
      </CardContent>
    </Card>
  )
}
