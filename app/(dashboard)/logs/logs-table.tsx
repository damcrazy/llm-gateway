"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  ColumnsIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SnowflakeIcon,
} from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/animate-ui/components/radix/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AttemptLogEntry } from "@/lib/db/types"
import { formatMs, formatNumber, formatUsd } from "@/lib/format"
import { cn } from "@/lib/utils"

import type { LogView } from "./_lib"
import { getRequestPayload, type RequestPayload } from "./actions"

/** Endpoints whose stored requests can be replayed in Compare. */
const REPLAYABLE = new Set([
  "chat.completions",
  "messages",
  "responses",
  "playground",
])

type PayloadState =
  | { status: "loading" }
  | { status: "loaded"; data: RequestPayload | null }
  | { status: "error"; error: string }

export function LogsTable({ logs }: { logs: LogView[] }) {
  const [selected, setSelected] = useState<LogView | null>(null)
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<PayloadState>({ status: "loading" })
  const requested = useRef<string | null>(null)

  function openLog(log: LogView) {
    setSelected(log)
    setOpen(true)
    setPayload({ status: "loading" })
    requested.current = log.id
    getRequestPayload(log.id)
      .then((result) => {
        if (requested.current !== log.id) return
        setPayload(
          result.ok
            ? { status: "loaded", data: result.data ?? null }
            : { status: "error", error: result.error }
        )
      })
      .catch((error: unknown) => {
        if (requested.current !== log.id) return
        setPayload({
          status: "error",
          error:
            error instanceof Error ? error.message : "Could not load payload",
        })
      })
  }

  // The first row (and the first with tag or PII badges) anchor tour steps.
  const firstBadged = logs.findIndex(
    (log) => log.tags?.length || log.pii_found?.length
  )

  return (
    <>
      <Table>
        <TableHeader data-tour="logs-columns">
          <TableRow>
            <TableHead className="pl-6">Time</TableHead>
            <TableHead>App</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Tokens in / out</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Latency</TableHead>
            <TableHead data-tour="logs-attempts" className="pr-6 text-right">
              Attempts
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log, index) => (
            <TableRow
              key={log.id}
              data-tour={index === 0 ? "logs-first-row" : undefined}
              tabIndex={0}
              data-state={
                open && selected?.id === log.id ? "selected" : undefined
              }
              className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none"
              onClick={() => openLog(log)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openLog(log)
                }
              }}
            >
              <TableCell className="pl-6 text-muted-foreground tabular-nums">
                {log.timeLabel}
              </TableCell>
              <TableCell
                className={cn(
                  "max-w-48",
                  !log.app_id && "text-muted-foreground"
                )}
              >
                <span className="block truncate">{log.appName}</span>
                {(log.tags?.length || log.pii_found?.length) && (
                  <span
                    data-tour={index === firstBadged ? "logs-tags" : undefined}
                    className="mt-1 flex flex-wrap gap-1"
                  >
                    {log.pii_found?.length ? (
                      <Badge variant="outline" className="font-normal">
                        <ShieldCheckIcon />
                        {log.status === "error" && log.http_status === 400
                          ? "PII blocked"
                          : "PII redacted"}
                      </Badge>
                    ) : null}
                    {log.tags?.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="max-w-32 truncate font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {(log.tags?.length ?? 0) > 3 && (
                      <Badge variant="secondary" className="font-normal">
                        +{log.tags!.length - 3}
                      </Badge>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <ModelCell log={log} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {log.providerName ?? "—"}
              </TableCell>
              <TableCell>
                <StatusCell status={log.status} http={log.http_status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <TokensCell log={log} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatUsd(Number(log.cost_usd))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMs(log.latency_ms)}
                {log.ttft_ms != null && (
                  <span className="block text-xs text-muted-foreground">
                    TTFT {formatMs(log.ttft_ms)}
                  </span>
                )}
              </TableCell>
              <TableCell className="pr-6 text-right">
                {log.attempts > 1 ? (
                  <Badge
                    variant="outline"
                    title="Fallback: more than one upstream attempt"
                  >
                    <RotateCcwIcon />
                    {log.attempts}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground tabular-nums">
                    {log.attempts}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-2xl">
          {selected ? (
            <LogDetails
              log={selected}
              payload={payload}
              onNavigate={() => setOpen(false)}
            />
          ) : (
            <SheetHeader>
              <SheetTitle>Request</SheetTitle>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}

function ModelCell({ log }: { log: LogView }) {
  const requested = log.requested_model
  const served = log.modelSlug
  if (!requested && !served)
    return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs">
      <span className="max-w-48 truncate">{requested ?? "—"}</span>
      {served && served !== requested && (
        <>
          <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="max-w-56 truncate text-muted-foreground">
            {served}
          </span>
        </>
      )}
    </span>
  )
}

function StatusCell({
  status,
  http,
}: {
  status: LogView["status"]
  http: number | null
}) {
  return (
    <span className="flex items-center gap-2">
      {status === "success" ? (
        <Badge variant="secondary">Success</Badge>
      ) : (
        <Badge variant="destructive">Error</Badge>
      )}
      {http != null && (
        <span className="font-mono text-xs text-muted-foreground">{http}</span>
      )}
    </span>
  )
}

function TokensCell({ log }: { log: LogView }) {
  const text = `${formatNumber(log.input_tokens)} / ${formatNumber(log.output_tokens)}`
  if (!log.usage_estimated) return <>{text}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-4">
          ≈ {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Estimated. The provider did not report token usage.
      </TooltipContent>
    </Tooltip>
  )
}

function Detail({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words",
          mono && "font-mono text-xs leading-5"
        )}
      >
        {children}
      </dd>
    </>
  )
}

function LogDetails({
  log,
  payload,
  onNavigate,
}: {
  log: LogView
  payload: PayloadState
  /** Closes the sheet when a link inside it changes the page's filters. */
  onNavigate: () => void
}) {
  const attempts: AttemptLogEntry[] = Array.isArray(log.attempt_log)
    ? log.attempt_log
    : []

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          <StatusCell status={log.status} http={log.http_status} />
          <span className="truncate font-mono text-sm">
            {log.requested_model ?? log.endpoint}
          </span>
        </SheetTitle>
        <SheetDescription>
          {log.timeLabel} · {log.appName}
        </SheetDescription>
        {REPLAYABLE.has(log.endpoint) &&
          payload.status === "loaded" &&
          payload.data?.request != null && (
            <div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/compare?request=${log.id}`} onClick={onNavigate}>
                  <ColumnsIcon />
                  Replay in Compare
                </Link>
              </Button>
            </div>
          )}
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid min-w-0 gap-6 p-4">
          {log.error_message && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>
                {log.http_status ? `Error ${log.http_status}` : "Error"}
              </AlertTitle>
              <AlertDescription className="break-words whitespace-pre-wrap">
                {log.error_message}
              </AlertDescription>
            </Alert>
          )}

          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Details</h3>
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <Detail label="Request ID" mono>
                <span className="inline-flex items-center gap-1">
                  {log.id}
                  <CopyButton
                    content={log.id}
                    variant="ghost"
                    size="xs"
                    aria-label="Copy request ID"
                  />
                </span>
              </Detail>
              <Detail label="Timestamp" mono>
                {log.created_at}
              </Detail>
              <Detail label="Endpoint" mono>
                {log.endpoint}
              </Detail>
              <Detail label="App">
                {log.appName}
                {log.appSlug && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">
                    ({log.appSlug})
                  </span>
                )}
              </Detail>
              <Detail label="API key ID" mono>
                {log.api_key_id ?? "—"}
              </Detail>
              <Detail label="Requested model" mono>
                {log.requested_model ?? "—"}
              </Detail>
              <Detail label="Route" mono>
                {log.routeName ?? (log.route_id ? "Deleted route" : "—")}
              </Detail>
              <Detail label="Served model" mono>
                {log.modelSlug ?? (log.model_id ? "Deleted model" : "—")}
              </Detail>
              <Detail label="Upstream model" mono>
                {log.upstream_model ?? "—"}
              </Detail>
              <Detail label="Provider">
                {log.providerName ??
                  (log.provider_id ? "Deleted provider" : "—")}
              </Detail>
              <Detail label="Status">
                {log.status}{" "}
                {log.http_status != null && `(HTTP ${log.http_status})`}
              </Detail>
              <Detail label="Streaming">{log.stream ? "Yes" : "No"}</Detail>
              <Detail label="Attempts">{log.attempts}</Detail>
              <Detail label="Input tokens">
                {formatNumber(log.input_tokens)}
              </Detail>
              <Detail label="Output tokens">
                {formatNumber(log.output_tokens)}
              </Detail>
              <Detail label="Cached tokens">
                {formatNumber(log.cached_tokens)}
              </Detail>
              <Detail label="Reasoning tokens">
                {formatNumber(log.reasoning_tokens)}
              </Detail>
              <Detail label="Token usage">
                {log.usage_estimated
                  ? "Estimated by the gateway"
                  : "Reported by provider"}
              </Detail>
              <Detail label="Cost">{formatUsd(Number(log.cost_usd))}</Detail>
              <Detail label="Latency">{formatMs(log.latency_ms)}</Detail>
              <Detail label="Time to first token">
                {formatMs(log.ttft_ms)}
              </Detail>
              <Detail label="User agent" mono>
                {log.user_agent ?? "—"}
              </Detail>
              <Detail label="Tags">
                {log.tags?.length ? (
                  <span className="flex flex-wrap gap-1">
                    {log.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" asChild>
                        <Link
                          href={`/logs?tag=${encodeURIComponent(tag)}`}
                          onClick={onNavigate}
                        >
                          {tag}
                        </Link>
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="End user" mono>
                {log.end_user ?? "—"}
              </Detail>
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <Detail label="Metadata" mono>
                  <span className="grid gap-0.5">
                    {Object.entries(log.metadata).map(([key, value]) => (
                      <span key={key} className="break-all">
                        {key}: {value}
                      </span>
                    ))}
                  </span>
                </Detail>
              )}
              {log.pii_found?.length ? (
                <Detail label="Personal data">
                  Found {log.pii_found.join(", ")};{" "}
                  {log.status === "error" && log.http_status === 400
                    ? "request refused"
                    : "replaced before reaching the provider"}
                </Detail>
              ) : null}
            </dl>
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-medium">
              Attempts{" "}
              <span className="font-normal text-muted-foreground">
                ({attempts.length})
              </span>
            </h3>
            {attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No upstream attempts were made.
              </p>
            ) : (
              <ItemGroup className="gap-2">
                {attempts.map((attempt, index) => (
                  <AttemptItem key={index} attempt={attempt} index={index} />
                ))}
              </ItemGroup>
            )}
          </section>

          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Payload</h3>
            <PayloadView payload={payload} />
          </section>
        </div>
      </div>
    </>
  )
}

function AttemptItem({
  attempt,
  index,
}: {
  attempt: AttemptLogEntry
  index: number
}) {
  const ok =
    attempt.status != null && attempt.status >= 200 && attempt.status < 300
  return (
    <Item variant="outline" size="sm" className="items-start">
      <ItemMedia className="font-mono text-xs text-muted-foreground">
        #{index + 1}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none w-full font-mono text-xs break-all">
          {attempt.provider} / {attempt.model}
        </ItemTitle>
        {attempt.error && (
          <ItemDescription className="line-clamp-none text-xs break-words whitespace-pre-wrap">
            {attempt.error}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap justify-end">
        <Badge variant={ok ? "secondary" : "destructive"} className="font-mono">
          {attempt.status ?? "no response"}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatMs(attempt.latency_ms)}
        </span>
        {attempt.cooldown_s != null && attempt.cooldown_s > 0 && (
          <Badge
            variant="outline"
            title="Model put on cooldown after this failure"
          >
            <SnowflakeIcon />
            {attempt.cooldown_s}s
          </Badge>
        )}
      </ItemActions>
    </Item>
  )
}

const MAX_PREVIEW_CHARS = 100_000

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? "null")
  const truncated = text.length > MAX_PREVIEW_CHARS
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b py-1 pr-1 pl-3">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
          {truncated && " (preview truncated, copy for the full body)"}
        </span>
        <CopyButton
          content={text}
          variant="ghost"
          size="xs"
          aria-label={`Copy ${title.toLowerCase()}`}
        />
      </div>
      <pre className="max-h-96 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text}
      </pre>
    </div>
  )
}

function PayloadView({ payload }: { payload: PayloadState }) {
  if (payload.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading payload…
      </p>
    )
  }
  if (payload.status === "error") {
    return <p className="text-sm text-destructive">{payload.error}</p>
  }
  if (!payload.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Not stored. Turn on &quot;Log full payloads&quot; in the app&apos;s
        settings to keep request and response bodies (for 7 days).
      </p>
    )
  }
  return (
    <div className="grid min-w-0 gap-3">
      <JsonBlock title="Request" value={payload.data.request} />
      <JsonBlock title="Response" value={payload.data.response} />
    </div>
  )
}
