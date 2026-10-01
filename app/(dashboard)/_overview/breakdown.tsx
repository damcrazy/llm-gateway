import { InboxIcon, TriangleAlertIcon } from "lucide-react"

import { Progress } from "@/components/animate-ui/components/radix/progress"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Card,
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
import {
  formatCompact,
  formatMs,
  formatNumber,
  formatPercent,
  formatUsd,
} from "@/lib/format"
import { cn } from "@/lib/utils"

import type { BreakdownItem } from "./data"

const HIGH_ERROR_RATE = 0.05

function ErrorRate({ item }: { item: BreakdownItem }) {
  if (item.errors === 0)
    return <span className="text-muted-foreground">0%</span>
  const rate = item.errors / item.requests
  if (rate < HIGH_ERROR_RATE) return <span>{formatPercent(rate)}</span>
  return (
    <Badge variant="destructive" title={`${formatNumber(item.errors)} failed`}>
      <TriangleAlertIcon />
      {formatPercent(rate)}
    </Badge>
  )
}

function BreakdownTable({
  items,
  nameLabel,
  period,
}: {
  items: BreakdownItem[]
  nameLabel: string
  period: string
}) {
  if (items.length === 0) {
    return (
      <Empty className="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle className="text-base">No requests</EmptyTitle>
          <EmptyDescription>
            Nothing went through the gateway in the {period}.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{nameLabel}</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead>Share</TableHead>
          <TableHead className="text-right">Tokens in / out</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Avg latency</TableHead>
          <TableHead className="pr-6 text-right">Error rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="max-w-64 pl-6">
              <div
                className={cn(
                  "truncate font-medium",
                  item.muted && "text-muted-foreground"
                )}
              >
                {item.name}
              </div>
              {item.detail && (
                <div className="truncate text-xs text-muted-foreground">
                  {item.detail}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatNumber(item.requests)}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Progress
                  value={Math.round(item.share * 100)}
                  className="h-1.5 w-16"
                  aria-label={`${item.name}: ${formatPercent(item.share)} of requests`}
                />
                <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                  {formatPercent(item.share)}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              <span className="text-foreground">
                {formatCompact(item.inputTokens)}
              </span>
              {" / "}
              <span className="text-foreground">
                {formatCompact(item.outputTokens)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatUsd(item.cost)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMs(item.avgLatencyMs)}
            </TableCell>
            <TableCell className="pr-6 text-right tabular-nums">
              <ErrorRate item={item} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function BreakdownCard({
  byModel,
  byProvider,
  byApp,
  period,
  className,
}: {
  byModel: BreakdownItem[]
  /** Omitted for members, who can't see providers. */
  byProvider?: BreakdownItem[]
  byApp: BreakdownItem[]
  /** e.g. "last 7 days" */
  period: string
  className?: string
}) {
  return (
    <Card className={cn("min-w-0 pb-2", className)}>
      <Tabs defaultValue="models" className="gap-4">
        <CardHeader>
          <CardTitle>Breakdown</CardTitle>
          <CardDescription>
            Where requests went, busiest first. Share is of all requests.
          </CardDescription>
        </CardHeader>
        <div className="px-6">
          <TabsList>
            <TabsTrigger value="models">Models</TabsTrigger>
            {byProvider && (
              <TabsTrigger value="providers">Providers</TabsTrigger>
            )}
            <TabsTrigger value="apps">Apps</TabsTrigger>
          </TabsList>
        </div>
        <TabsContents>
          <TabsContent value="models">
            <BreakdownTable items={byModel} nameLabel="Model" period={period} />
          </TabsContent>
          {byProvider && (
            <TabsContent value="providers">
              <BreakdownTable
                items={byProvider}
                nameLabel="Provider"
                period={period}
              />
            </TabsContent>
          )}
          <TabsContent value="apps">
            <BreakdownTable items={byApp} nameLabel="App" period={period} />
          </TabsContent>
        </TabsContents>
      </Tabs>
    </Card>
  )
}
