import type { Metadata } from "next"
import {
  GaugeIcon,
  HourglassIcon,
  PieChartIcon,
  ServerIcon,
  TimerIcon,
} from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireMember } from "@/lib/auth"
import { formatRelative } from "@/lib/format"

import { loadLatency, type PhaseStat } from "./data"
import { CallBar, LatencyControls, LatencyLegend } from "./latency-controls"
import {
  FAILED_STYLE,
  GATEWAY_COLOR,
  LATENCY_RANGES,
  PHASE_LABELS,
  formatMs,
  parseLatencyRange,
} from "./shared"

export const metadata: Metadata = { title: "Latency" }

const UUID = /^[0-9a-f-]{36}$/i

export default async function LatencyPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; app?: string }>
}) {
  const me = await requireMember()
  const params = await searchParams
  const range = parseLatencyRange(params.range)
  const appId = params.app && UUID.test(params.app) ? params.app : null
  const data = await loadLatency(range, appId)
  const { summary } = data

  return (
    <>
      <PageTour id="latency" />
      <PageHeader
        title="Latency"
        description={
          <>
            Where each call&apos;s time goes: waiting on the provider, or work
            the gateway itself adds (key check, limits, routing, retries).{" "}
            {me.isAdmin ? "All apps." : "Your apps."} Measured inside the
            gateway, so network time to your client isn&apos;t included.
          </>
        }
        actions={
          <LatencyControls range={range} appId={appId} apps={data.apps} />
        }
      />

      {summary.calls === 0 ? (
        <Empty className="border" data-tour="latency-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GaugeIcon />
            </EmptyMedia>
            <EmptyTitle>No calls to measure yet</EmptyTitle>
            <EmptyDescription>
              {LATENCY_RANGES[range].long}, no API calls with a timing
              breakdown. Calls made from now on show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div
            data-tour="latency-tiles"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Tile
              icon={TimerIcon}
              label="Total, median"
              value={formatMs(summary.total.p50)}
              detail={`95th percentile ${formatMs(summary.total.p95)} · ${summary.calls} calls${summary.errors ? `, ${summary.errors} failed` : ""}`}
            />
            <Tile
              icon={ServerIcon}
              label="At the provider, median"
              value={formatMs(summary.provider.p50)}
              detail={`95th percentile ${formatMs(summary.provider.p95)}`}
            />
            <Tile
              icon={HourglassIcon}
              label="Added by the gateway, median"
              value={formatMs(summary.gateway.p50)}
              detail={`95th percentile ${formatMs(summary.gateway.p95)}`}
            />
            <Tile
              icon={PieChartIcon}
              label="Gateway share of total time"
              value={`${(summary.gatewayShare * 100).toFixed(summary.gatewayShare < 0.1 ? 1 : 0)}%`}
              detail="Across successful calls"
            />
          </div>

          <Card data-tour="latency-phases">
            <CardHeader>
              <CardTitle>Where the gateway&apos;s time goes</CardTitle>
              <CardDescription>
                Average per successful call, with the 95th percentile (the
                slowest 5%).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PhaseBars
                phases={data.phases}
                total={summary.calls - summary.errors}
              />
            </CardContent>
          </Card>

          <Card className="pb-0">
            <CardHeader data-tour="latency-calls">
              <CardTitle>Recent calls</CardTitle>
              <CardDescription>
                Each bar is one call&apos;s total time, split by where it went.
                Hover a bar for the breakdown.
              </CardDescription>
              <CardAction>
                <LatencyLegend />
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="w-[30%]">Time split</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Provider</TableHead>
                    <TableHead className="pr-6 text-right">Gateway</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.calls.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="pl-6 whitespace-nowrap">
                        <div className="text-sm">{formatRelative(call.at)}</div>
                        <div className="text-xs text-muted-foreground">
                          {call.app ?? "Playground"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-72 truncate font-mono text-xs">
                            {call.model}
                          </span>
                          {call.stream && (
                            <Badge variant="secondary" className="font-normal">
                              stream
                            </Badge>
                          )}
                          {call.cached && (
                            <Badge variant="outline" className="font-normal">
                              cached
                            </Badge>
                          )}
                          {!call.ok && (
                            <Badge
                              variant="destructive"
                              className="font-normal"
                            >
                              failed
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {call.provider ?? "—"}
                          {call.via && ` · via ${call.via}`}
                          {call.attempts > 1 && ` · ${call.attempts} attempts`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <CallBar call={call} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMs(call.total)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatMs(call.provider_ms)}
                      </TableCell>
                      <TableCell className="pr-6 text-right font-medium tabular-nums">
                        {formatMs(call.gateway)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="pb-0" data-tour="latency-models">
            <CardHeader>
              <CardTitle>By model</CardTitle>
              <CardDescription>
                Medians for the models that answered most often.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">First token</TableHead>
                    <TableHead className="text-right">Provider</TableHead>
                    <TableHead className="text-right">Gateway</TableHead>
                    <TableHead className="pr-6 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byModel.map((row) => (
                    <TableRow key={row.model}>
                      <TableCell className="pl-6">
                        <div className="max-w-80 truncate font-mono text-xs">
                          {row.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.provider ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.calls}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatMs(row.firstToken)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMs(row.provider_ms)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMs(row.gateway)}
                      </TableCell>
                      <TableCell className="pr-6 text-right font-medium tabular-nums">
                        {formatMs(row.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
}) {
  return (
    <Card size="sm" className="min-w-0 gap-2">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="truncate text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  )
}

/** One row per gateway phase: average bar (scaled to the largest), p95. */
function PhaseBars({ phases, total }: { phases: PhaseStat[]; total: number }) {
  const max = Math.max(...phases.map((phase) => phase.avg), 0.1)
  return (
    <div className="grid gap-3">
      {phases.map((phase) => {
        const meta = PHASE_LABELS[phase.key]
        return (
          <div
            key={phase.key}
            className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr_9rem] sm:items-center"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{meta.label}</div>
              <div className="text-xs text-muted-foreground">{meta.help}</div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-sm bg-muted">
              {phase.avg > 0 && (
                <div
                  className="h-full min-w-1 rounded-sm"
                  style={{
                    width: `${(phase.avg / max) * 100}%`,
                    ...(phase.key === "failed"
                      ? FAILED_STYLE
                      : { background: GATEWAY_COLOR }),
                  }}
                />
              )}
            </div>
            <div className="text-sm tabular-nums sm:text-right">
              {formatMs(phase.avg)}
              <span className="text-xs text-muted-foreground">
                {" "}
                · p95 {formatMs(phase.p95)}
              </span>
              <div className="text-xs text-muted-foreground">
                in {phase.calls} of {total} calls
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
