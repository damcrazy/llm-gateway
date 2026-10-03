import "server-only"

import { randomUUID } from "node:crypto"

import type { AttemptLogEntry } from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"

import type { CacheStatus } from "./cache"
import type { ModelRuntime, RouteRuntime } from "./config"
import type { Usage } from "./types"
import { costUsd } from "./usage"

const MAX_PAYLOAD_STRING = 20_000

/** Shrinks huge strings (base64 images, long documents) before storing payloads. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[truncated]"
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.length > 200)
      return `${value.slice(0, 60)}…[${value.length} chars omitted]`
    return value.length > MAX_PAYLOAD_STRING
      ? `${value.slice(0, MAX_PAYLOAD_STRING)}…[truncated]`
      : value
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, depth + 1)])
    )
  }
  return value
}

/** Where a request's time went, in milliseconds. */
export interface RequestTimings {
  total: number
  /** API key lookup. */
  auth?: number
  /** Rate limit and budget checks. */
  limits?: number
  /** Looking up the response cache. */
  cache?: number
  /** Reading the body, routing and translating, before the first provider call. */
  prepare: number
  /** Deliberate pauses before retrying a model. */
  retry_wait?: number
  /** Provider time spent on attempts that failed (and were failed over). */
  failed?: number
  /** The answering provider, until its first byte or token. */
  provider_first?: number
  /** The answering provider, until it finished. */
  provider?: number
  /** After the provider finished, until the response was complete. */
  post?: number
  /** Everything that wasn't a provider: total - provider - failed. */
  overhead: number
}

type TimedPhase = "auth" | "limits" | "cache" | "retry_wait" | "failed"

const ms = (value: number) => Math.round(value * 10) / 10

/** Collects everything about one gateway request and writes it to request_logs. */
export class RequestRecorder {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
  // High-resolution clock for the latency breakdown.
  private readonly t0 = performance.now()
  private endPerf?: number
  private spans: Partial<Record<TimedPhase, number>> = {}
  private firstAttemptAt?: number
  private servedSpan?: { start: number; first: number; end?: number }
  readonly done: Promise<void>
  private resolveDone!: () => void
  private shouldLog = false
  private finished = false

  appId: string | null = null
  apiKeyId: string | null = null
  ownerEmail: string | null = null
  logPayloads = false
  requestedModel?: string
  route?: RouteRuntime
  served?: ModelRuntime
  attempts: AttemptLogEntry[] = []
  stream = false
  usage?: Usage
  ttftMs?: number
  /** Set when the app uses the response cache. */
  cacheStatus?: CacheStatus
  endedAt?: number
  status: "success" | "error" = "success"
  httpStatus = 200
  errorMessage?: string
  requestBody?: unknown
  responseBody?: unknown
  readonly userAgent: string | null

  constructor(
    readonly endpoint: string,
    request?: Request
  ) {
    this.userAgent = request?.headers.get("user-agent")?.slice(0, 300) ?? null
    this.done = new Promise((resolve) => (this.resolveDone = resolve))
  }

  /** Only authenticated (or dashboard) traffic is logged. */
  enableLogging(options: {
    appId: string | null
    apiKeyId: string | null
    ownerEmail: string | null
    logPayloads: boolean
  }) {
    this.appId = options.appId
    this.apiKeyId = options.apiKeyId
    this.ownerEmail = options.ownerEmail
    this.logPayloads = options.logPayloads
    this.shouldLog = true
  }

  fail(status: number, message: string) {
    this.status = "error"
    this.httpStatus = status
    this.errorMessage = message.slice(0, 2000)
    this.finish()
  }

  finish() {
    if (this.finished) return
    this.finished = true
    this.endedAt = Date.now()
    this.endPerf = performance.now()
    this.providerDone()
    this.resolveDone()
  }

  /** Times one of the gateway's own phases (auth, limits). */
  async timed<T>(phase: "auth" | "limits", work: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await work()
    } finally {
      this.addSpan(phase, performance.now() - start)
    }
  }

  addSpan(phase: TimedPhase, duration: number) {
    this.spans[phase] = (this.spans[phase] ?? 0) + duration
  }

  /** Call when a provider attempt starts; pass the result to the outcome. */
  attemptStarted(): number {
    const now = performance.now()
    this.firstAttemptAt ??= now
    return now
  }

  attemptFailed(start: number) {
    this.addSpan("failed", performance.now() - start)
  }

  /**
   * The attempt that answers. A streamed one has only produced its first
   * chunk so far; `providerDone` marks when the provider finished.
   */
  attemptSucceeded(start: number, streaming: boolean) {
    const now = performance.now()
    this.servedSpan = { start, first: now, end: streaming ? undefined : now }
  }

  providerDone() {
    if (this.servedSpan && this.servedSpan.end === undefined)
      this.servedSpan.end = performance.now()
  }

  get timings(): RequestTimings {
    const end = this.endPerf ?? performance.now()
    const total = end - this.t0
    const auth = this.spans.auth ?? 0
    const limits = this.spans.limits ?? 0
    const cache = this.spans.cache ?? 0
    const failed = this.spans.failed ?? 0
    const served = this.servedSpan
    const providerEnd = served ? (served.end ?? end) : undefined
    const provider = served ? providerEnd! - served.start : 0
    const timings: RequestTimings = {
      total: ms(total),
      prepare: ms(
        Math.max(
          0,
          (this.firstAttemptAt ?? end) - this.t0 - auth - limits - cache
        )
      ),
      overhead: ms(Math.max(0, total - provider - failed)),
    }
    if (this.spans.auth !== undefined) timings.auth = ms(auth)
    if (this.spans.limits !== undefined) timings.limits = ms(limits)
    if (this.spans.cache !== undefined) timings.cache = ms(cache)
    if (this.spans.retry_wait) timings.retry_wait = ms(this.spans.retry_wait)
    if (failed) timings.failed = ms(failed)
    if (served) {
      timings.provider_first = ms(served.first - served.start)
      timings.provider = ms(provider)
      timings.post = ms(Math.max(0, end - providerEnd!))
    }
    return timings
  }

  get costUsd(): number {
    // A cached answer cost nothing upstream.
    if (this.cacheStatus === "HIT") return 0
    return this.served && this.usage ? costUsd(this.served, this.usage) : 0
  }

  get latencyMs(): number {
    return (this.endedAt ?? Date.now()) - this.startedAt
  }

  async persist(): Promise<void> {
    await this.done
    if (!this.shouldLog) return
    const usage = this.usage
    const timings = this.timings
    const db = supabaseAdmin()
    const { error } = await db.from("request_logs").insert({
      id: this.id,
      app_id: this.appId,
      api_key_id: this.apiKeyId,
      owner_email: this.ownerEmail,
      endpoint: this.endpoint,
      requested_model: this.requestedModel ?? null,
      route_id: this.route?.id ?? null,
      model_id: this.served?.id ?? null,
      provider_id: this.served?.provider.id ?? null,
      upstream_model: this.served?.model_id ?? null,
      status: this.status,
      http_status: this.httpStatus,
      error_message: this.errorMessage ?? null,
      stream: this.stream,
      attempts: Math.max(this.attempts.length, 1),
      attempt_log: this.attempts,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      cached_tokens: usage?.cachedTokens ?? 0,
      reasoning_tokens: usage?.reasoningTokens ?? 0,
      usage_estimated: usage?.estimated ?? false,
      cost_usd: this.costUsd,
      latency_ms: this.latencyMs,
      ttft_ms: this.ttftMs ?? null,
      timings,
      cache_hit: this.cacheStatus === "HIT",
      provider_ms: Math.round(timings.provider ?? 0),
      overhead_ms: Math.round(timings.overhead),
      user_agent: this.userAgent,
    })
    if (error) {
      console.error("[gateway] failed to write request log:", error.message)
      return
    }
    if (this.logPayloads) {
      const { error: payloadError } = await db.from("request_payloads").insert({
        request_id: this.id,
        request: redact(this.requestBody) ?? null,
        response: redact(this.responseBody) ?? null,
      })
      if (payloadError)
        console.error(
          "[gateway] failed to write payload:",
          payloadError.message
        )
    }
  }
}
