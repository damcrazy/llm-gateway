import { ChartNoAxesColumnIcon } from "lucide-react"

import { Progress } from "@/components/animate-ui/components/radix/progress"
import {
  Card,
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
import type { UsageBreakdownRow } from "@/lib/db/types"
import {
  formatCompact,
  formatMs,
  formatNumber,
  formatPercent,
  formatUsd,
} from "@/lib/format"

export function UsageSection({
  rows,
  modelSlugs,
  monthSpend,
  monthlyBudget,
}: {
  rows: UsageBreakdownRow[]
  modelSlugs: Map<string, string>
  monthSpend: number
  monthlyBudget: number | null
}) {
  const totals = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + Number(row.requests),
      errors: acc.errors + Number(row.errors),
      tokens: acc.tokens + Number(row.input_tokens) + Number(row.output_tokens),
      cost: acc.cost + Number(row.cost_usd),
    }),
    { requests: 0, errors: 0, tokens: 0, cost: 0 }
  )
  const errorRate = totals.requests ? totals.errors / totals.requests : 0

  const stats = [
    { label: "Requests", value: formatNumber(totals.requests) },
    { label: "Tokens", value: formatCompact(totals.tokens) },
    { label: "Cost", value: formatUsd(totals.cost) },
    { label: "Error rate", value: formatPercent(errorRate) },
  ]

  const budgetUsed =
    monthlyBudget && monthlyBudget > 0
      ? Math.min(100, (monthSpend / monthlyBudget) * 100)
      : null

  return (
    <div className="grid min-w-0 gap-4">
      <div
        className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        data-tour="app-usage-stats"
      >
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription>{stat.label} · 30 days</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {monthlyBudget != null && (
        <Card size="sm" data-tour="app-usage-budget">
          <CardHeader>
            <CardDescription>Budget this month (UTC)</CardDescription>
            <CardTitle className="tabular-nums">
              {formatUsd(monthSpend)}{" "}
              <span className="font-normal text-muted-foreground">
                of {formatUsd(monthlyBudget)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress
              value={budgetUsed ?? 100}
              aria-label="Monthly budget used"
            />
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty className="min-h-80 border" data-tour="app-usage-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No usage in the last 30 days</EmptyTitle>
            <EmptyDescription>
              Requests made with this app&apos;s keys show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0" data-tour="app-usage-table">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Model</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Input tokens</TableHead>
                  <TableHead className="text-right">Output tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="pr-6 text-right">Avg latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id ?? "none"}>
                    <TableCell className="pl-6 font-mono text-xs">
                      {row.id ? (
                        (modelSlugs.get(row.id) ?? "Deleted model")
                      ) : (
                        <span className="font-sans text-muted-foreground">
                          No model (failed before routing)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(row.requests))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(row.errors))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(row.input_tokens))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(Number(row.output_tokens))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(Number(row.cost_usd))}
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {formatMs(
                        row.avg_latency_ms == null
                          ? null
                          : Number(row.avg_latency_ms)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
