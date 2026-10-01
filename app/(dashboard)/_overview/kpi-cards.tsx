import {
  ActivityIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CoinsIcon,
  HashIcon,
  MinusIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  formatCompact,
  formatMs,
  formatNumber,
  formatPercent,
  formatUsd,
} from "@/lib/format"
import { cn } from "@/lib/utils"

import type { Totals } from "./data"

/** Which direction is an improvement; "neutral" deltas are never colored. */
type Better = "up" | "down" | "neutral"

type Change =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "relative"; value: number }
  | { kind: "points"; value: number }

function relativeChange(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" }
  return { kind: "relative", value: (current - previous) / previous }
}

function formatCount(value: number): string {
  return value < 10_000 ? formatNumber(value) : formatCompact(value)
}

function Delta({
  change,
  better,
  period,
}: {
  change: Change
  better: Better
  period: string
}) {
  if (change.kind === "none") {
    return <span className="text-muted-foreground">Nothing to compare</span>
  }
  if (change.kind === "new") {
    return <span className="text-muted-foreground">Nothing in {period}</span>
  }

  const threshold = change.kind === "relative" ? 0.005 : 0.0005
  const direction =
    Math.abs(change.value) < threshold ? 0 : Math.sign(change.value)
  const good =
    better === "neutral" || direction === 0
      ? null
      : direction > 0 === (better === "up")
  const Icon =
    direction > 0
      ? ArrowUpRightIcon
      : direction < 0
        ? ArrowDownRightIcon
        : MinusIcon
  const sign = direction > 0 ? "+" : direction < 0 ? "−" : ""
  const magnitude = Math.abs(change.value)
  const text =
    direction === 0
      ? "No change"
      : change.kind === "relative"
        ? `${sign}${magnitude >= 1 ? `${formatNumber(Math.round(magnitude * 100))}%` : formatPercent(magnitude)}`
        : `${sign}${(magnitude * 100).toFixed(magnitude * 100 < 1 ? 2 : 1)} pp`

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          good === true && "text-emerald-600 dark:text-emerald-400",
          good === false && "text-destructive",
          good === null && "text-foreground"
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {text}
      </span>
      <span className="text-muted-foreground">vs {period}</span>
    </span>
  )
}

function StatTile({
  label,
  icon: Icon,
  value,
  title,
  detail,
  change,
  better,
  period,
  className,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  value: string
  title?: string
  detail?: React.ReactNode
  change: Change
  better: Better
  period: string
  className?: string
}) {
  return (
    <Card size="sm" className={cn("min-w-0 gap-2", className)}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle
          className="truncate text-2xl font-semibold tracking-tight"
          title={title}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="gap-1 text-xs">
        {detail && <p className="text-muted-foreground">{detail}</p>}
        <Delta change={change} better={better} period={period} />
      </CardContent>
    </Card>
  )
}

export function KpiCards({
  current,
  previous,
  period,
}: {
  current: Totals
  previous: Totals
  /** e.g. "previous 7 days" */
  period: string
}) {
  const tokens = current.inputTokens + current.outputTokens
  const prevTokens = previous.inputTokens + previous.outputTokens
  const errorRate = current.requests > 0 ? current.errors / current.requests : 0
  const prevErrorRate =
    previous.requests > 0 ? previous.errors / previous.requests : 0
  const latency =
    current.requests > 0 ? current.latencySum / current.requests : null
  const prevLatency =
    previous.requests > 0 ? previous.latencySum / previous.requests : null

  const errorChange: Change =
    previous.requests === 0
      ? current.requests === 0
        ? { kind: "none" }
        : { kind: "new" }
      : current.requests === 0
        ? { kind: "none" }
        : { kind: "points", value: errorRate - prevErrorRate }
  const latencyChange: Change =
    latency == null
      ? { kind: "none" }
      : prevLatency == null
        ? { kind: "new" }
        : relativeChange(latency, prevLatency)

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <StatTile
        label="Requests"
        icon={ActivityIcon}
        value={formatCount(current.requests)}
        title={formatNumber(current.requests)}
        change={relativeChange(current.requests, previous.requests)}
        better="neutral"
        period={period}
      />
      <StatTile
        label="Tokens"
        icon={HashIcon}
        value={formatCount(tokens)}
        title={formatNumber(tokens)}
        detail={`${formatCompact(current.inputTokens)} in · ${formatCompact(current.outputTokens)} out`}
        change={relativeChange(tokens, prevTokens)}
        better="neutral"
        period={period}
      />
      <StatTile
        label="Cost"
        icon={CoinsIcon}
        value={formatUsd(current.cost)}
        change={relativeChange(current.cost, previous.cost)}
        better="neutral"
        period={period}
      />
      <StatTile
        label="Error rate"
        icon={TriangleAlertIcon}
        value={current.requests > 0 ? formatPercent(errorRate) : "—"}
        detail={`${formatNumber(current.errors)} failed`}
        change={errorChange}
        better="down"
        period={period}
      />
      <StatTile
        label="Avg latency"
        icon={TimerIcon}
        value={formatMs(latency)}
        detail="Weighted by requests"
        change={latencyChange}
        better="down"
        period={period}
        className="col-span-2 lg:col-span-1"
      />
    </div>
  )
}
