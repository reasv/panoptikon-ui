"use client"

import { components } from "@/lib/panoptikon"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

type SearchMetrics = components["schemas"]["SearchMetrics"]

const CACHE_BADGE_STYLES: Record<string, string> = {
  hit: "bg-green-500/15 text-green-600 dark:text-green-400",
  stale: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  miss: "bg-muted text-muted-foreground",
  bypass: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground",
}

function formatSeconds(value: number): string {
  return `${value >= 0.1 ? value.toFixed(2) : value.toFixed(4)}s`
}

function MetricsSection({
  title,
  metrics,
}: {
  title: string
  metrics?: SearchMetrics
}) {
  // Degrade gracefully: results-only/count-only requests, instant search
  // off, or responses predating the newer fields simply omit lines.
  if (!metrics) return null
  const rows: [string, number | undefined][] = [
    ["Preprocess", metrics.preprocess],
    ["Build", metrics.build],
    ["Compile", metrics.compile],
    ["DB", metrics.execute],
    ["Enrich", metrics.enrich],
  ]
  const shownRows = rows.filter(
    (row): row is [string, number] => typeof row[1] === "number"
  )
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {metrics.cache && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium capitalize",
              CACHE_BADGE_STYLES[metrics.cache]
            )}
            title="Search result cache outcome for this request"
          >
            {metrics.cache}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
        {shownRows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="text-right tabular-nums">{formatSeconds(value)}</dd>
          </div>
        ))}
        {typeof metrics.prefetched_pages === "number" &&
          metrics.prefetched_pages > 0 && (
            <div className="contents">
              <dt>Prefetched</dt>
              <dd className="text-right tabular-nums">
                {metrics.prefetched_pages}{" "}
                {metrics.prefetched_pages === 1 ? "page" : "pages"}
              </dd>
            </div>
          )}
      </dl>
    </div>
  )
}

// Query-timing breakdown card on the result count. Hover-only is fine per
// the desktop-first stance.
export function SearchMetricsHoverCard({
  resultMetrics,
  countMetrics,
  children,
}: {
  resultMetrics?: SearchMetrics
  countMetrics?: SearchMetrics
  children: React.ReactNode
}) {
  if (!resultMetrics && !countMetrics) return <>{children}</>
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 space-y-3">
        <MetricsSection title="Results" metrics={resultMetrics} />
        <MetricsSection title="Count" metrics={countMetrics} />
      </HoverCardContent>
    </HoverCard>
  )
}
