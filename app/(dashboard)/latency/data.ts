import "server-only"

import type { RequestTimings } from "@/lib/gateway/recorder"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import { LATENCY_RANGES, type LatencyRange } from "./shared"

/** One call, split into provider time and the gateway's own time (ms). */
export interface CallTiming {
  id: string
  at: string
  app: string | null
  model: string
  /** What the client asked for (a bucket, route or model), if different. */
  via: string | null
  provider: string | null
  endpoint: string
  stream: boolean
  ok: boolean
  /** Answered from the response cache. */
  cached: boolean
  attempts: number
  total: number
  /** The answering provider, start to finish. */
  provider_ms: number
  /** Provider time spent on attempts that failed over. */
  failed: number
  /** Everything else: key check, limits, routing, retry waits, finishing. */
  gateway: number
  /** Gateway time before the first provider call. */
  before: number
  /** Gateway time between attempts and after the provider finished. */
  after: number
  firstToken: number | null
  phases: GatewayPhases
}

export interface GatewayPhases {
  auth: number
  limits: number
  cache: number
  prepare: number
  retry_wait: number
  post: number
}

export interface LatencySummary {
  calls: number
  errors: number
  total: Percentiles
  provider: Percentiles
  gateway: Percentiles
  /** Share of all successful calls' time spent in the gateway. */
  gatewayShare: number
}

export interface Percentiles {
  p50: number
  p95: number
}

export interface PhaseStat {
  key: keyof GatewayPhases | "failed"
  avg: number
  p95: number
  /** Calls where this phase took any time at all. */
  calls: number
}

export interface ModelLatency {
  model: string
  provider: string | null
  calls: number
  total: number
  provider_ms: number
  firstToken: number | null
  gateway: number
}

export interface LatencyData {
  calls: CallTiming[]
  summary: LatencySummary
  phases: PhaseStat[]
  byModel: ModelLatency[]
  apps: { id: string; name: string }[]
}

const MAX_ROWS = 2000
const RECENT = 50

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return sorted[Math.max(0, index)]!
}

function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) }
}

const round = (value: number) => Math.round(value * 10) / 10

/** Calls with a latency breakdown in the range (RLS: members see their own). */
export async function loadLatency(
  range: LatencyRange,
  appId: string | null
): Promise<LatencyData> {
  const supabase = await createClient()
  const since = new Date(Date.now() - LATENCY_RANGES[range].ms).toISOString()
  let query = supabase
    .from("request_logs")
    .select(
      "id, created_at, app_id, requested_model, model_id, provider_id, endpoint, stream, status, attempts, ttft_ms, timings, cache_hit"
    )
    .gte("created_at", since)
    .not("timings", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS)
  if (appId) query = query.eq("app_id", appId)

  const [logsResult, appsResult, modelsResult] = await Promise.all([
    query,
    supabase.from("apps").select("id, name").order("name"),
    supabase.from("models").select("id, slug"),
  ])
  if (logsResult.error) throw new Error(logsResult.error.message)

  const rows = (logsResult.data ?? []) as {
    id: string
    created_at: string
    app_id: string | null
    requested_model: string | null
    model_id: string | null
    provider_id: string | null
    endpoint: string
    stream: boolean
    status: string
    attempts: number
    ttft_ms: number | null
    timings: RequestTimings
    cache_hit: boolean | null
  }[]
  const apps = (appsResult.data ?? []) as { id: string; name: string }[]
  const appName = new Map(apps.map((app) => [app.id, app.name]))
  const modelSlug = new Map(
    ((modelsResult.data ?? []) as { id: string; slug: string }[]).map((m) => [
      m.id,
      m.slug,
    ])
  )
  // Provider names (members can't read shared providers directly).
  const providerIds = [...new Set(rows.map((r) => r.provider_id))].filter(
    (id): id is string => Boolean(id)
  )
  const { data: providerRows } = providerIds.length
    ? await supabaseAdmin()
        .from("providers")
        .select("id, name")
        .in("id", providerIds)
    : { data: [] }
  const providerName = new Map(
    ((providerRows ?? []) as { id: string; name: string }[]).map((p) => [
      p.id,
      p.name,
    ])
  )

  const calls: CallTiming[] = rows.map((row) => {
    const t = row.timings
    const phases: GatewayPhases = {
      auth: t.auth ?? 0,
      limits: t.limits ?? 0,
      cache: t.cache ?? 0,
      prepare: t.prepare ?? 0,
      retry_wait: t.retry_wait ?? 0,
      post: t.post ?? 0,
    }
    const before = phases.auth + phases.limits + phases.cache + phases.prepare
    const model =
      (row.model_id && modelSlug.get(row.model_id)) ||
      row.requested_model ||
      "—"
    return {
      id: row.id,
      at: row.created_at,
      app: row.app_id ? (appName.get(row.app_id) ?? null) : null,
      model,
      via:
        row.requested_model && row.requested_model !== model
          ? row.requested_model
          : null,
      provider: row.provider_id
        ? (providerName.get(row.provider_id) ?? null)
        : null,
      endpoint: row.endpoint,
      stream: row.stream,
      ok: row.status === "success",
      cached: row.cache_hit === true,
      attempts: row.attempts,
      total: t.total,
      provider_ms: t.provider ?? 0,
      failed: t.failed ?? 0,
      gateway: t.overhead,
      before: round(before),
      after: round(Math.max(0, t.overhead - before)),
      firstToken: t.provider_first ?? null,
      phases,
    }
  })

  const ok = calls.filter((call) => call.ok)
  const totalTime = ok.reduce((sum, call) => sum + call.total, 0)
  const gatewayTime = ok.reduce((sum, call) => sum + call.gateway, 0)
  const summary: LatencySummary = {
    calls: calls.length,
    errors: calls.length - ok.length,
    total: percentiles(ok.map((c) => c.total)),
    provider: percentiles(ok.map((c) => c.provider_ms)),
    gateway: percentiles(ok.map((c) => c.gateway)),
    gatewayShare: totalTime > 0 ? gatewayTime / totalTime : 0,
  }

  const phaseKeys: PhaseStat["key"][] = [
    "auth",
    "limits",
    "cache",
    "prepare",
    "retry_wait",
    "failed",
    "post",
  ]
  const phases: PhaseStat[] = phaseKeys.map((key) => {
    const values = ok.map((call) =>
      key === "failed" ? call.failed : call.phases[key]
    )
    const sum = values.reduce((a, b) => a + b, 0)
    return {
      key,
      avg: ok.length ? round(sum / ok.length) : 0,
      p95: round(percentiles(values).p95),
      calls: values.filter((v) => v > 0).length,
    }
  })

  const groups = new Map<string, CallTiming[]>()
  for (const call of ok) {
    groups.set(call.model, [...(groups.get(call.model) ?? []), call])
  }
  const byModel: ModelLatency[] = [...groups.entries()]
    .map(([model, list]) => {
      const firsts = list
        .filter((c) => c.stream && c.firstToken != null)
        .map((c) => c.firstToken!)
      return {
        model,
        provider: list[0]?.provider ?? null,
        calls: list.length,
        total: percentiles(list.map((c) => c.total)).p50,
        provider_ms: percentiles(list.map((c) => c.provider_ms)).p50,
        firstToken: firsts.length ? percentiles(firsts).p50 : null,
        gateway: percentiles(list.map((c) => c.gateway)).p50,
      }
    })
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 15)

  return {
    calls: calls.slice(0, RECENT),
    summary,
    phases,
    byModel,
    apps,
  }
}
