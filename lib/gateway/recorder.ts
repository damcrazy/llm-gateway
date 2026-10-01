import "server-only"

import { randomUUID } from "node:crypto"

import type { AttemptLogEntry } from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"

import type { ModelRuntime, RouteRuntime } from "./config"
import type { Usage } from "./types"
import { costUsd } from "./usage"

const MAX_PAYLOAD_STRING = 20_000

/** Shrinks huge strings (base64 images, long documents) before storing payloads. */
function redact(value: unknown, depth = 0): unknown {
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

/** Collects everything about one gateway request and writes it to request_logs. */
export class RequestRecorder {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
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
    this.resolveDone()
  }

  get costUsd(): number {
    return this.served && this.usage ? costUsd(this.served, this.usage) : 0
  }

  get latencyMs(): number {
    return (this.endedAt ?? Date.now()) - this.startedAt
  }

  async persist(): Promise<void> {
    await this.done
    if (!this.shouldLog) return
    const usage = this.usage
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
