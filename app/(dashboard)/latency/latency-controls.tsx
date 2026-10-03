"use client"

import { useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AppWindowIcon } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

import type { CallTiming } from "./data"
import {
  FAILED_STYLE,
  GATEWAY_COLOR,
  LATENCY_RANGES,
  PHASE_LABELS,
  PROVIDER_COLOR,
  formatMs,
  type LatencyRange,
} from "./shared"

const ALL_APPS = "__all"

export function LatencyControls({
  range,
  appId,
  apps,
}: {
  range: LatencyRange
  appId: string | null
  apps: { id: string; name: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function update(key: "range" | "app", value: string | null) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() =>
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
        scroll: false,
      })
    )
  }

  return (
    <div
      data-tour="latency-controls"
      className="flex flex-wrap items-center gap-2"
    >
      {pending && <Spinner className="size-4" />}
      {apps.length > 1 && (
        <Select
          value={appId ?? ALL_APPS}
          onValueChange={(value) =>
            update("app", value === ALL_APPS ? null : value)
          }
        >
          <SelectTrigger className="w-44" aria-label="Filter by app">
            <AppWindowIcon className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value={ALL_APPS}>All apps</SelectItem>
            {apps.map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={range}
        onValueChange={(value) => value && update("range", value)}
        aria-label="Time range"
      >
        {(Object.keys(LATENCY_RANGES) as LatencyRange[]).map((key) => (
          <ToggleGroupItem
            key={key}
            value={key}
            aria-label={LATENCY_RANGES[key].long}
            className="px-3"
          >
            {LATENCY_RANGES[key].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function LatencyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-sm"
          style={{ background: PROVIDER_COLOR }}
        />
        Provider
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-sm"
          style={{ background: GATEWAY_COLOR }}
        />
        Gateway (this app)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={FAILED_STYLE} />
        Failed attempts
      </span>
    </div>
  )
}

interface Segment {
  key: string
  value: number
  style: React.CSSProperties
}

/**
 * One call as a bar split by where its time went: gateway before the
 * provider, failed attempts, the provider, gateway after. Hover for detail.
 */
export function CallBar({ call }: { call: CallTiming }) {
  const segments: Segment[] = [
    { key: "before", value: call.before, style: { background: GATEWAY_COLOR } },
    { key: "failed", value: call.failed, style: FAILED_STYLE },
    {
      key: "provider",
      value: call.provider_ms,
      style: { background: PROVIDER_COLOR },
    },
    { key: "after", value: call.after, style: { background: GATEWAY_COLOR } },
  ].filter((segment) => segment.value > 0)
  const total = Math.max(call.total, 0.1)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex h-3 w-full min-w-24 cursor-default gap-0.5 overflow-hidden rounded-sm"
          role="img"
          aria-label={`${formatMs(call.total)} total: provider ${formatMs(call.provider_ms)}, gateway ${formatMs(call.gateway)}${call.failed ? `, failed attempts ${formatMs(call.failed)}` : ""}`}
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={cn(
                "h-full min-w-1 first:rounded-l-sm last:rounded-r-sm"
              )}
              style={{
                ...segment.style,
                flexGrow: segment.value / total,
                flexBasis: 0,
              }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent className="min-w-56">
        <div className="grid gap-1 text-xs">
          <div className="flex justify-between gap-4 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatMs(call.total)}</span>
          </div>
          <BreakdownLine label="Provider" value={call.provider_ms} />
          {call.firstToken != null && call.stream && (
            <BreakdownLine
              label="· first token"
              value={call.firstToken}
              muted
            />
          )}
          {call.failed > 0 && (
            <BreakdownLine
              label={PHASE_LABELS.failed.label}
              value={call.failed}
            />
          )}
          <BreakdownLine label="Gateway" value={call.gateway} />
          {(
            [
              "auth",
              "limits",
              "cache",
              "prepare",
              "retry_wait",
              "post",
            ] as const
          )
            .filter((key) => call.phases[key] > 0)
            .map((key) => (
              <BreakdownLine
                key={key}
                label={`· ${PHASE_LABELS[key].label.toLowerCase()}`}
                value={call.phases[key]}
                muted
              />
            ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function BreakdownLine({
  label,
  value,
  muted = false,
}: {
  label: string
  value: number
  muted?: boolean
}) {
  return (
    <div
      className={cn("flex justify-between gap-4", muted && "pl-2 opacity-80")}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatMs(value)}</span>
    </div>
  )
}
