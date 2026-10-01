import type { Metadata } from "next"
import Link from "next/link"
import { ScrollTextIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { requireMember } from "@/lib/auth"
import type { RequestLogRow } from "@/lib/db/types"
import { formatNumber } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

import {
  DASHBOARD_APP,
  filtersToQuery,
  formatLogTime,
  PAGE_SIZE,
  parseFilters,
  rangeStart,
  RANGES,
  type LogFilters,
  type LogView,
} from "./_lib"
import { LogFiltersBar } from "./log-filters"
import { LogsTable } from "./logs-table"

export const metadata: Metadata = { title: "Logs" }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LogsPage({ searchParams }: Props) {
  await requireMember()
  const filters = parseFilters(await searchParams)
  const supabase = await createClient()

  const [appsResult, modelsResult, providersResult, routesResult] =
    await Promise.all([
      supabase.from("apps").select("id, name, slug").order("name"),
      supabase.from("models").select("id, slug").order("slug"),
      supabase.from("providers").select("id, name"),
      supabase.from("routes").select("id, name"),
    ])
  const apps = (appsResult.data ?? []) as {
    id: string
    name: string
    slug: string
  }[]
  const models = (modelsResult.data ?? []) as { id: string; slug: string }[]
  const providers = (providersResult.data ?? []) as {
    id: string
    name: string
  }[]
  const routes = (routesResult.data ?? []) as { id: string; name: string }[]

  const appById = new Map(apps.map((a) => [a.id, a]))
  const modelById = new Map(models.map((m) => [m.id, m.slug]))
  const providerById = new Map(providers.map((p) => [p.id, p.name]))
  const routeById = new Map(routes.map((r) => [r.id, r.name]))

  // Resolve slug filters to ids. An unknown slug matches nothing.
  const appId =
    filters.app && filters.app !== DASHBOARD_APP
      ? (apps.find((a) => a.slug === filters.app)?.id ?? null)
      : undefined
  const modelId = filters.model
    ? (models.find((m) => m.slug === filters.model)?.id ?? null)
    : undefined
  const unresolved = appId === null || modelId === null

  let rows: RequestLogRow[] = []
  let total = 0
  let queryError: string | null = null
  let pastEnd = false

  if (!unresolved) {
    const from = (filters.page - 1) * PAGE_SIZE
    let query = supabase
      .from("request_logs")
      .select("*", { count: "exact" })
      .gte("created_at", rangeStart(filters.range))
    if (filters.status !== "all") query = query.eq("status", filters.status)
    if (filters.app === DASHBOARD_APP) query = query.is("app_id", null)
    else if (appId) query = query.eq("app_id", appId)
    if (modelId) query = query.eq("model_id", modelId)

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    // PGRST103: the requested page is beyond the last row.
    if (error?.code === "PGRST103") pastEnd = true
    else if (error) queryError = error.message
    rows = (data ?? []) as RequestLogRow[]
    total = count ?? 0
  }

  const logs: LogView[] = rows.map((row) => {
    const app = row.app_id ? appById.get(row.app_id) : undefined
    return {
      ...row,
      timeLabel: formatLogTime(row.created_at),
      appName: row.app_id ? (app?.name ?? "Deleted app") : "Dashboard",
      appSlug: app?.slug ?? null,
      routeName: row.route_id ? (routeById.get(row.route_id) ?? null) : null,
      modelSlug: row.model_id ? (modelById.get(row.model_id) ?? null) : null,
      providerName: row.provider_id
        ? (providerById.get(row.provider_id) ?? null)
        : null,
    }
  })

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeLabel =
    RANGES.find((r) => r.value === filters.range)?.label.toLowerCase() ?? ""
  const firstShown = total ? (filters.page - 1) * PAGE_SIZE + 1 : 0
  const lastShown = Math.min(total, filters.page * PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="Logs"
        description="Every request that went through the gateway. Click a row for attempts and payloads."
      />
      <LogFiltersBar
        filters={filters}
        apps={apps.map(({ slug, name }) => ({ slug, name }))}
        models={models.map((m) => m.slug)}
      />
      {queryError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load logs</AlertTitle>
          <AlertDescription>{queryError}</AlertDescription>
        </Alert>
      )}
      <Card className="py-0">
        <CardContent className="px-0">
          {logs.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollTextIcon />
                </EmptyMedia>
                <EmptyTitle>No requests</EmptyTitle>
                <EmptyDescription>
                  {pastEnd || (filters.page > 1 && total > 0)
                    ? "This page is past the end of the results."
                    : `Nothing matches these filters in the ${rangeLabel}.`}
                </EmptyDescription>
              </EmptyHeader>
              {(pastEnd || (filters.page > 1 && total > 0)) && (
                <EmptyContent>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href={`/logs${filtersToQuery({ ...filters, page: 1 })}`}
                    >
                      Back to the first page
                    </Link>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <LogsTable logs={logs} />
          )}
        </CardContent>
      </Card>
      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm whitespace-nowrap text-muted-foreground">
            {firstShown <= lastShown
              ? `${formatNumber(firstShown)}–${formatNumber(lastShown)} of ${formatNumber(total)}`
              : `${formatNumber(total)} requests`}
          </p>
          {pageCount > 1 && (
            <LogsPagination filters={filters} pageCount={pageCount} />
          )}
        </div>
      )}
    </>
  )
}

/** Page numbers to show: first, last, and the current page's neighbours. */
function pageWindow(current: number, count: number): (number | "gap")[] {
  const pages = new Set([1, count, current - 1, current, current + 1])
  const sorted = [...pages]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b)
  const out: (number | "gap")[] = []
  for (const page of sorted) {
    const prev = out[out.length - 1]
    if (typeof prev === "number" && page - prev > 1) out.push("gap")
    out.push(page)
  }
  return out
}

function LogsPagination({
  filters,
  pageCount,
}: {
  filters: LogFilters
  pageCount: number
}) {
  const current = Math.min(filters.page, pageCount)
  const href = (page: number) => `/logs${filtersToQuery({ ...filters, page })}`

  return (
    <Pagination className="mx-0 w-auto">
      <PaginationContent className="flex-wrap">
        <PaginationItem>
          <PaginationPrevious
            href={href(Math.max(1, current - 1))}
            aria-disabled={current <= 1}
            className={
              current <= 1 ? "pointer-events-none opacity-50" : undefined
            }
          />
        </PaginationItem>
        {pageWindow(current, pageCount).map((page, index) =>
          page === "gap" ? (
            <PaginationItem key={`gap-${index}`} className="hidden sm:block">
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem
              key={page}
              className={page === current ? undefined : "hidden sm:block"}
            >
              <PaginationLink
                href={href(page)}
                isActive={page === filters.page}
              >
                {page}
              </PaginationLink>
            </PaginationItem>
          )
        )}
        <PaginationItem>
          <PaginationNext
            href={href(Math.min(pageCount, current + 1))}
            aria-disabled={current >= pageCount}
            className={
              current >= pageCount
                ? "pointer-events-none opacity-50"
                : undefined
            }
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
