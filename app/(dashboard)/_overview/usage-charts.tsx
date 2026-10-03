"use client"

import { useState, useSyncExternalStore } from "react"
import { ChartColumnIcon, TableIcon } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCompact, formatNumber, formatUsd } from "@/lib/format"
import { cn } from "@/lib/utils"

import type { SeriesPoint } from "./data"
import type { BucketInterval } from "./range"

// Series colors are the theme's categorical --chart-* slots in fixed order
// (each token already has a light and a dark step), plus the --destructive
// status token for errors.
const PRIMARY = "var(--chart-1)"
const SECONDARY = "var(--chart-2)"

const requestsConfig = {
  success: { label: "Successful", color: PRIMARY },
  errors: { label: "Errors", color: "var(--destructive)" },
} satisfies ChartConfig

const costConfig = {
  cost: { label: "Cost", color: PRIMARY },
} satisfies ChartConfig

const tokensConfig = {
  input: { label: "Input", color: PRIMARY },
  output: { label: "Output", color: SECONDARY },
} satisfies ChartConfig

const ACTIVE_DOT = { r: 4, stroke: "var(--card)", strokeWidth: 2 }

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTick(iso: string, interval: BucketInterval): string {
  const date = new Date(iso)
  return interval === "hour"
    ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
}

function formatBucket(
  iso: string,
  interval: BucketInterval,
  inProgress: boolean
): string {
  const date = new Date(iso)
  const label =
    interval === "hour"
      ? date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : `${date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })} (UTC)`
  return inProgress ? `${label} · so far` : label
}

function formatCount(value: number): string {
  return value < 10_000 ? formatNumber(value) : formatCompact(value)
}

function formatUsdTick(value: number): string {
  if (value === 0) return "$0"
  if (Math.abs(value) >= 1000) return `$${formatCompact(value)}`
  if (Math.abs(value) >= 1) return `$${Number(value.toFixed(2))}`
  return `$${Number(value.toPrecision(2))}`
}

/** Tooltip row: a line key in the series color, then the label and value in text ink. */
function tooltipRow(config: ChartConfig, format: (value: number) => string) {
  return function TooltipRow(
    value: unknown,
    name: unknown,
    item: { color?: string }
  ) {
    const key = String(name)
    return (
      <>
        <div
          className="w-1 shrink-0 self-stretch rounded-[2px]"
          style={{ backgroundColor: item.color }}
        />
        <div className="flex flex-1 items-center justify-between gap-4 leading-none">
          <span className="text-muted-foreground">
            {config[key]?.label ?? key}
          </span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {format(Number(value ?? 0))}
          </span>
        </div>
      </>
    )
  }
}

function bucketLabel(data: SeriesPoint[], interval: BucketInterval) {
  const last = data.at(-1)?.bucket
  return function BucketLabel(
    _: unknown,
    payload: ReadonlyArray<{ payload?: unknown }>
  ) {
    const point = payload[0]?.payload as SeriesPoint | undefined
    return point
      ? formatBucket(point.bucket, interval, point.bucket === last)
      : null
  }
}

// ---------------------------------------------------------------------------
// Card shell: chart / table toggle (the table is the accessible twin)
// ---------------------------------------------------------------------------

const noopSubscribe = () => () => {}

/** False during SSR and hydration, so time labels render in the viewer's timezone. */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

interface Column {
  label: string
  value: (point: SeriesPoint) => number
  format: (value: number) => string
}

function ChartCard({
  title,
  description,
  data,
  interval,
  columns,
  className,
  children,
}: {
  title: string
  description: string
  data: SeriesPoint[]
  interval: BucketInterval
  columns: Column[]
  className?: string
  children: React.ReactNode
}) {
  const [view, setView] = useState<"chart" | "table">("chart")
  const hydrated = useHydrated()

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={view}
            onValueChange={(value) => {
              if (value === "chart" || value === "table") setView(value)
            }}
            aria-label={`${title} view`}
          >
            <ToggleGroupItem value="chart" aria-label="Show chart">
              <ChartColumnIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Show table">
              <TableIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!hydrated ? (
          <div className="h-64" />
        ) : view === "chart" ? (
          children
        ) : (
          <ScrollArea className="h-64 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">
                    {interval === "hour" ? "Hour" : "Day"}
                  </TableHead>
                  {columns.map((column) => (
                    <TableHead
                      key={column.label}
                      className="text-right last:pr-3"
                    >
                      {column.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data
                  .map((point, index) => ({
                    point,
                    inProgress: index === data.length - 1,
                  }))
                  .reverse()
                  .map(({ point, inProgress }) => (
                    <TableRow key={point.bucket}>
                      <TableCell className="pl-3 text-muted-foreground">
                        {formatBucket(point.bucket, interval, inProgress)}
                      </TableCell>
                      {columns.map((column) => (
                        <TableCell
                          key={column.label}
                          className="text-right tabular-nums last:pr-3"
                        >
                          {column.format(column.value(point))}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

interface ChartProps {
  data: SeriesPoint[]
  interval: BucketInterval
  className?: string
}

function cadence(interval: BucketInterval) {
  return interval === "hour" ? "per hour" : "per UTC day"
}

/** Part-to-whole over time: stacked columns, errors in the status color. */
function RequestsChart({ data, interval, className }: ChartProps) {
  return (
    <ChartCard
      title="Requests"
      description={`Successful and failed requests ${cadence(interval)}`}
      data={data}
      interval={interval}
      className={className}
      columns={[
        {
          label: "Requests",
          value: (p) => p.success + p.errors,
          format: formatNumber,
        },
        { label: "Successful", value: (p) => p.success, format: formatNumber },
        { label: "Errors", value: (p) => p.errors, format: formatNumber },
      ]}
    >
      <ChartContainer
        config={requestsConfig}
        className="aspect-auto h-64 w-full"
      >
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatTick(value, interval)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tickFormatter={(value: number) => formatCompact(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={bucketLabel(data, interval)}
                formatter={tooltipRow(requestsConfig, formatNumber)}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="success"
            stackId="requests"
            fill="var(--color-success)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="errors"
            stackId="requests"
            fill="var(--color-errors)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

/** Single series trend: area with a light wash, no legend (the title names it). */
function CostChart({ data, interval, className }: ChartProps) {
  return (
    <ChartCard
      title="Cost"
      description={`Spend in USD ${cadence(interval)}`}
      data={data}
      interval={interval}
      className={className}
      columns={[{ label: "Cost", value: (p) => p.cost, format: formatUsd }]}
    >
      <ChartContainer config={costConfig} className="aspect-auto h-64 w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatTick(value, interval)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => formatUsdTick(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={bucketLabel(data, interval)}
                formatter={tooltipRow(costConfig, formatUsd)}
              />
            }
          />
          <Area
            dataKey="cost"
            type="monotone"
            stroke="var(--color-cost)"
            strokeWidth={2}
            fill="var(--color-cost)"
            fillOpacity={0.1}
            dot={false}
            activeDot={ACTIVE_DOT}
          />
        </AreaChart>
      </ChartContainer>
    </ChartCard>
  )
}

/** Two series on one shared token axis. */
function TokensChart({ data, interval, className }: ChartProps) {
  return (
    <ChartCard
      title="Tokens"
      description={`Input and output tokens ${cadence(interval)}`}
      data={data}
      interval={interval}
      className={className}
      columns={[
        { label: "Input", value: (p) => p.input, format: formatNumber },
        { label: "Output", value: (p) => p.output, format: formatNumber },
      ]}
    >
      <ChartContainer config={tokensConfig} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucket"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value: string) => formatTick(value, interval)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            allowDecimals={false}
            tickFormatter={(value: number) => formatCompact(value)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={bucketLabel(data, interval)}
                formatter={tooltipRow(tokensConfig, formatCount)}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="input"
            type="monotone"
            stroke="var(--color-input)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={ACTIVE_DOT}
          />
          <Line
            dataKey="output"
            type="monotone"
            stroke="var(--color-output)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={ACTIVE_DOT}
          />
        </LineChart>
      </ChartContainer>
    </ChartCard>
  )
}

/** All three charts; one client boundary so the series is serialized once. */
export function UsageCharts({ data, interval }: ChartProps) {
  return (
    <div data-tour="overview-charts" className="grid gap-4 lg:grid-cols-2">
      <RequestsChart
        data={data}
        interval={interval}
        className="lg:col-span-2"
      />
      <CostChart data={data} interval={interval} />
      <TokensChart data={data} interval={interval} />
    </div>
  )
}
