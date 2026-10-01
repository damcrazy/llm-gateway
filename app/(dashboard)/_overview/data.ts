import "server-only"

import type {
  ModelHealthRow,
  UsageBreakdownRow,
  UsageTimeseriesRow,
} from "@/lib/db/types"
import { createClient } from "@/lib/supabase/server"

import {
  bucketIndex,
  getRangeWindow,
  type RangeKey,
  type RangeWindow,
} from "./range"

/** One chart bucket. Serializable so it can be handed to client charts. */
export interface SeriesPoint {
  bucket: string
  success: number
  errors: number
  input: number
  output: number
  cost: number
}

export interface Totals {
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  cost: number
  /** Sum of latency over all requests, reconstructed from per-id averages. */
  latencySum: number
}

export interface BreakdownItem {
  key: string
  name: string
  detail?: string
  muted?: boolean
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  cost: number
  avgLatencyMs: number | null
  share: number
}

export interface CoolingModel {
  modelId: string
  name: string
  slug: string | null
  cooldownUntil: string
  /** Seconds until the cooldown ends, as of page render. */
  remainingSeconds: number
  consecutiveFailures: number
  lastStatus: number | null
  lastError: string | null
}

export interface Inventory {
  providers: { enabled: number; total: number }
  models: { enabled: number; total: number }
  routes: { enabled: number; total: number }
  apps: { enabled: number; total: number }
  activeKeys: number
}

export interface OverviewData {
  window: RangeWindow
  series: SeriesPoint[]
  current: Totals
  previous: Totals
  byModel: BreakdownItem[]
  byProvider: BreakdownItem[]
  byApp: BreakdownItem[]
  cooling: CoolingModel[]
  inventory: Inventory
  hasAnyTraffic: boolean
  errors: string[]
}

const TOP_ROWS = 10

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function emptyTotals(): Totals {
  return {
    requests: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    latencySum: 0,
  }
}

function sumRows(rows: UsageBreakdownRow[]): Totals {
  const totals = emptyTotals()
  for (const row of rows) {
    const requests = num(row.requests)
    totals.requests += requests
    totals.errors += num(row.errors)
    totals.inputTokens += num(row.input_tokens)
    totals.outputTokens += num(row.output_tokens)
    totals.cost += num(row.cost_usd)
    if (row.avg_latency_ms != null)
      totals.latencySum += num(row.avg_latency_ms) * requests
  }
  return totals
}

/** Previous period = (previous + current) - current, clamped at zero. */
function subtractTotals(a: Totals, b: Totals): Totals {
  return {
    requests: Math.max(0, a.requests - b.requests),
    errors: Math.max(0, a.errors - b.errors),
    inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
    outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
    cost: Math.max(0, a.cost - b.cost),
    latencySum: Math.max(0, a.latencySum - b.latencySum),
  }
}

type Namer = (id: string | null) => {
  name: string
  detail?: string
  muted?: boolean
}

function toBreakdown(
  rows: UsageBreakdownRow[],
  totalRequests: number,
  namer: Namer
): BreakdownItem[] {
  const items: BreakdownItem[] = rows
    .map((row) => {
      const requests = num(row.requests)
      return {
        key: row.id ?? "none",
        ...namer(row.id),
        requests,
        errors: num(row.errors),
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
        cost: num(row.cost_usd),
        avgLatencyMs:
          row.avg_latency_ms == null ? null : num(row.avg_latency_ms),
        share: totalRequests > 0 ? requests / totalRequests : 0,
      }
    })
    .filter((item) => item.requests > 0)
    .sort((a, b) => b.requests - a.requests || b.cost - a.cost)

  if (items.length <= TOP_ROWS + 1) return items

  const top = items.slice(0, TOP_ROWS)
  const rest = items.slice(TOP_ROWS)
  const other = rest.reduce(
    (acc, item) => {
      acc.requests += item.requests
      acc.errors += item.errors
      acc.inputTokens += item.inputTokens
      acc.outputTokens += item.outputTokens
      acc.cost += item.cost
      if (item.avgLatencyMs != null) {
        acc.latencySum += item.avgLatencyMs * item.requests
        acc.latencyRequests += item.requests
      }
      return acc
    },
    {
      requests: 0,
      errors: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latencySum: 0,
      latencyRequests: 0,
    }
  )
  top.push({
    key: "other",
    name: `Other (${rest.length})`,
    muted: true,
    requests: other.requests,
    errors: other.errors,
    inputTokens: other.inputTokens,
    outputTokens: other.outputTokens,
    cost: other.cost,
    avgLatencyMs:
      other.latencyRequests > 0
        ? other.latencySum / other.latencyRequests
        : null,
    share: totalRequests > 0 ? other.requests / totalRequests : 0,
  })
  return top
}

function countEnabled(rows: { enabled: boolean }[] | null) {
  const list = rows ?? []
  return {
    enabled: list.filter((row) => row.enabled).length,
    total: list.length,
  }
}

/** Fetches everything the overview needs in one parallel round. */
export async function loadOverview(range: RangeKey): Promise<OverviewData> {
  const now = new Date()
  const window = getRangeWindow(range, now)
  const since = window.since.toISOString()
  const supabase = await createClient()

  const [
    timeseriesRes,
    byModelRes,
    byProviderRes,
    byAppRes,
    sincePrevRes,
    modelsRes,
    providersRes,
    appsRes,
    routesRes,
    keysRes,
    healthRes,
    anyTrafficRes,
  ] = await Promise.all([
    supabase.rpc("usage_timeseries", {
      p_since: since,
      p_interval: window.interval,
    }),
    supabase.rpc("usage_breakdown", { p_since: since, p_dimension: "model" }),
    supabase.rpc("usage_breakdown", {
      p_since: since,
      p_dimension: "provider",
    }),
    supabase.rpc("usage_breakdown", { p_since: since, p_dimension: "app" }),
    // Previous + current combined; the previous period is the difference.
    supabase.rpc("usage_breakdown", {
      p_since: window.prevSince.toISOString(),
      p_dimension: "provider",
    }),
    supabase.from("models").select("id, slug, display_name, enabled"),
    supabase.from("providers").select("id, name, enabled"),
    supabase.from("apps").select("id, name, enabled"),
    supabase.from("routes").select("id, enabled"),
    supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .is("revoked_at", null),
    supabase
      .from("model_health")
      .select(
        "model_id, cooldown_until, consecutive_failures, last_status, last_error"
      )
      .gt("cooldown_until", now.toISOString())
      .order("cooldown_until", { ascending: false }),
    supabase.from("usage_hourly").select("bucket").limit(1),
  ])

  const errors = [
    timeseriesRes.error,
    byModelRes.error,
    byProviderRes.error,
    byAppRes.error,
    sincePrevRes.error,
    modelsRes.error,
    providersRes.error,
    appsRes.error,
    routesRes.error,
    keysRes.error,
    healthRes.error,
    anyTrafficRes.error,
  ]
    .filter((error) => error != null)
    .map((error) => error.message)

  // Lookups
  const models = (modelsRes.data ?? []) as {
    id: string
    slug: string
    display_name: string | null
    enabled: boolean
  }[]
  const providers = (providersRes.data ?? []) as {
    id: string
    name: string
    enabled: boolean
  }[]
  const apps = (appsRes.data ?? []) as {
    id: string
    name: string
    enabled: boolean
  }[]
  const modelById = new Map(models.map((model) => [model.id, model]))
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider])
  )
  const appById = new Map(apps.map((app) => [app.id, app]))

  // Time series, with every bucket present so lines never skip.
  const series: SeriesPoint[] = window.bucketStarts.map((start) => ({
    bucket: new Date(start).toISOString(),
    success: 0,
    errors: 0,
    input: 0,
    output: 0,
    cost: 0,
  }))
  for (const row of (timeseriesRes.data ?? []) as UsageTimeseriesRow[]) {
    const point = series[bucketIndex(window, row.bucket)]
    const requests = num(row.requests)
    const failed = num(row.errors)
    point.success += Math.max(0, requests - failed)
    point.errors += failed
    point.input += num(row.input_tokens)
    point.output += num(row.output_tokens)
    point.cost += num(row.cost_usd)
  }

  // KPIs
  const current = sumRows((byProviderRes.data ?? []) as UsageBreakdownRow[])
  const combined = sumRows((sincePrevRes.data ?? []) as UsageBreakdownRow[])
  const previous = sincePrevRes.error
    ? emptyTotals()
    : subtractTotals(combined, current)

  // Breakdowns
  const byModel = toBreakdown(
    (byModelRes.data ?? []) as UsageBreakdownRow[],
    current.requests,
    (id) => {
      if (!id)
        return {
          name: "Not routed",
          detail: "Failed before a model was chosen",
          muted: true,
        }
      const model = modelById.get(id)
      if (!model) return { name: "Deleted model", muted: true }
      return model.display_name
        ? { name: model.display_name, detail: model.slug }
        : { name: model.slug }
    }
  )
  const byProvider = toBreakdown(
    (byProviderRes.data ?? []) as UsageBreakdownRow[],
    current.requests,
    (id) => {
      if (!id)
        return {
          name: "Not routed",
          detail: "Failed before a provider was chosen",
          muted: true,
        }
      const provider = providerById.get(id)
      return provider
        ? { name: provider.name }
        : { name: "Deleted provider", muted: true }
    }
  )
  const byApp = toBreakdown(
    (byAppRes.data ?? []) as UsageBreakdownRow[],
    current.requests,
    (id) => {
      if (!id) return { name: "Dashboard / playground", muted: true }
      const app = appById.get(id)
      return app ? { name: app.name } : { name: "Deleted app", muted: true }
    }
  )

  // Health
  const healthRows = (healthRes.data ?? []) as Pick<
    ModelHealthRow,
    | "model_id"
    | "cooldown_until"
    | "consecutive_failures"
    | "last_status"
    | "last_error"
  >[]
  const cooling: CoolingModel[] = healthRows
    .filter((row) => row.cooldown_until)
    .map((row) => {
      const model = modelById.get(row.model_id)
      return {
        modelId: row.model_id,
        name: model?.display_name ?? model?.slug ?? "Unknown model",
        slug: model?.display_name ? model.slug : null,
        cooldownUntil: row.cooldown_until as string,
        remainingSeconds: Math.max(
          0,
          Math.round(
            (new Date(row.cooldown_until as string).getTime() - now.getTime()) /
              1000
          )
        ),
        consecutiveFailures: num(row.consecutive_failures),
        lastStatus: row.last_status,
        lastError: row.last_error,
      }
    })

  const inventory: Inventory = {
    providers: countEnabled(providers),
    models: countEnabled(models),
    routes: countEnabled((routesRes.data ?? []) as { enabled: boolean }[]),
    apps: countEnabled(apps),
    activeKeys: keysRes.count ?? 0,
  }

  return {
    window,
    series,
    current,
    previous,
    byModel,
    byProvider,
    byApp,
    cooling,
    inventory,
    hasAnyTraffic:
      current.requests > 0 || (anyTrafficRes.data ?? []).length > 0,
    errors,
  }
}
