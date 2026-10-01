// Filter parsing and small helpers for the logs page (server and client safe).

import type { RequestLogRow } from "@/lib/db/types"

export const PAGE_SIZE = 50

/** Sentinel for requests made from the dashboard itself (app_id is null). */
export const DASHBOARD_APP = "_dashboard"

export const RANGES = [
  { value: "1h", label: "Last hour", ms: 3_600_000 },
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
] as const

export type RangeValue = (typeof RANGES)[number]["value"]
export type StatusFilter = "all" | "success" | "error"

export interface LogFilters {
  status: StatusFilter
  /** App slug, DASHBOARD_APP, or "" for all apps. */
  app: string
  /** Served model slug, or "" for all models. */
  model: string
  range: RangeValue
  page: number
}

export const DEFAULT_FILTERS: LogFilters = {
  status: "all",
  app: "",
  model: "",
  range: "24h",
  page: 1,
}

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

export function parseFilters(params: SearchParams): LogFilters {
  const status = first(params.status)
  const range = first(params.range)
  const page = Number.parseInt(first(params.page), 10)
  return {
    status: status === "success" || status === "error" ? status : "all",
    app: first(params.app).slice(0, 100),
    model: first(params.model).slice(0, 200),
    range: RANGES.some((r) => r.value === range)
      ? (range as RangeValue)
      : DEFAULT_FILTERS.range,
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  }
}

/** Query string (with leading "?", or "" when everything is default). */
export function filtersToQuery(filters: LogFilters): string {
  const params = new URLSearchParams()
  if (filters.status !== DEFAULT_FILTERS.status)
    params.set("status", filters.status)
  if (filters.app) params.set("app", filters.app)
  if (filters.model) params.set("model", filters.model)
  if (filters.range !== DEFAULT_FILTERS.range)
    params.set("range", filters.range)
  if (filters.page > 1) params.set("page", String(filters.page))
  const query = params.toString()
  return query ? `?${query}` : ""
}

export function rangeStart(range: RangeValue): string {
  const ms = RANGES.find((r) => r.value === range)?.ms ?? 86_400_000
  return new Date(Date.now() - ms).toISOString()
}

/** "Oct 1, 09:41:07 AM" */
export function formatLogTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** A request log row with ids resolved to names for display. */
export interface LogView extends RequestLogRow {
  timeLabel: string
  appName: string
  appSlug: string | null
  routeName: string | null
  modelSlug: string | null
  providerName: string | null
}
