import "server-only"

import { randomBytes, randomUUID } from "node:crypto"

import { decryptSecret } from "@/lib/crypto"
import { publicFetch } from "@/lib/net/public-fetch"
import { supabaseAdmin } from "@/lib/supabase/admin"

import type { AuthContext } from "./auth"
import { redact, type RequestRecorder, type RequestTimings } from "./recorder"

// Sends each request to the app owner's Langfuse project and/or
// OpenTelemetry collector (OTLP/HTTP JSON), after the response is sent.
// Prompts and answers are included only for apps that store payloads.

export interface TraceRecord {
  id: string
  appId: string
  appName: string
  endpoint: string
  requestedModel: string | null
  servedModel: string | null
  upstreamModel: string | null
  providerName: string | null
  providerType: string | null
  start: number
  end: number
  firstTokenAt: number | null
  ok: boolean
  httpStatus: number
  error: string | null
  stream: boolean
  attempts: number
  cache: string | null
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  costUsd: number
  timings: RequestTimings
  parameters: Record<string, unknown>
  input?: unknown
  output?: unknown
}

interface ExportSettings {
  langfuse: { host: string; publicKey: string; secret: string } | null
  otel: { endpoint: string; headersSecret: string | null } | null
}

const SETTINGS_TTL_MS = 60_000
const ERROR_WRITE_MS = 60_000
const MAX_ENTRIES = 5_000
const TIMEOUT_MS = 5_000
const PARAMETER_KEYS = [
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "reasoning_effort",
  "seed",
  "stop",
]

const settingsCache = new Map<
  string,
  { at: number; settings: ExportSettings | null }
>()
const lastStatusWrite = new Map<string, number>()

export function forgetExportSettings(email: string) {
  settingsCache.delete(email)
}

/** The enabled destinations, or null; `fresh` skips the minute-long cache. */
export async function loadExportSettings(
  email: string,
  { fresh = false } = {}
): Promise<ExportSettings | null> {
  const cached = settingsCache.get(email)
  if (!fresh && cached && Date.now() - cached.at < SETTINGS_TTL_MS)
    return cached.settings
  const { data } = await supabaseAdmin()
    .from("trace_exports")
    .select(
      "langfuse_enabled, langfuse_host, langfuse_public_key, langfuse_secret, otel_enabled, otel_endpoint, otel_headers_secret"
    )
    .eq("owner_email", email)
    .maybeSingle()
  let settings: ExportSettings | null = null
  if (data) {
    const langfuse =
      data.langfuse_enabled &&
      data.langfuse_host &&
      data.langfuse_public_key &&
      data.langfuse_secret
        ? {
            host: data.langfuse_host as string,
            publicKey: data.langfuse_public_key as string,
            secret: data.langfuse_secret as string,
          }
        : null
    const otel =
      data.otel_enabled && data.otel_endpoint
        ? {
            endpoint: data.otel_endpoint as string,
            headersSecret: (data.otel_headers_secret as string | null) ?? null,
          }
        : null
    settings = langfuse || otel ? { langfuse, otel } : null
  }
  if (settingsCache.size >= MAX_ENTRIES) settingsCache.clear()
  settingsCache.set(email, { at: Date.now(), settings })
  return settings
}

/** The answer part of a stored response, whatever surface produced it. */
function outputOf(body: unknown): unknown {
  const choice = (body as { choices?: { message?: unknown }[] } | undefined)
    ?.choices?.[0]
  return choice?.message ?? body
}

export function traceRecord(
  recorder: RequestRecorder,
  { app }: AuthContext
): TraceRecord {
  const served = recorder.served
  const usage = recorder.usage
  const body = (recorder.requestBody ?? {}) as Record<string, unknown>
  const parameters = Object.fromEntries(
    PARAMETER_KEYS.filter((key) => body[key] !== undefined).map((key) => [
      key,
      body[key],
    ])
  )
  const record: TraceRecord = {
    id: recorder.id,
    appId: app.id,
    appName: app.name,
    endpoint: recorder.endpoint,
    requestedModel: recorder.requestedModel ?? null,
    servedModel: served?.slug ?? null,
    upstreamModel: served?.model_id ?? null,
    providerName: served?.provider.name ?? null,
    providerType: served?.provider.type ?? null,
    start: recorder.startedAt,
    end: recorder.endedAt ?? Date.now(),
    firstTokenAt:
      recorder.ttftMs != null ? recorder.startedAt + recorder.ttftMs : null,
    ok: recorder.status === "success",
    httpStatus: recorder.httpStatus,
    error: recorder.errorMessage ?? null,
    stream: recorder.stream,
    attempts: Math.max(recorder.attempts.length, 1),
    cache: recorder.cacheStatus ?? null,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cachedTokens: usage?.cachedTokens ?? 0,
    reasoningTokens: usage?.reasoningTokens ?? 0,
    costUsd: recorder.costUsd,
    timings: recorder.timings,
    parameters,
  }
  if (recorder.logPayloads) {
    const input = body.messages ?? body.input ?? recorder.requestBody
    record.input = redact(
      body.system ? { system: body.system, messages: input } : input
    )
    record.output = redact(outputOf(recorder.responseBody))
  }
  return record
}

// ---------------------------------------------------------------------------
// Langfuse (public ingestion API)
// ---------------------------------------------------------------------------

export function langfuseBatch(record: TraceRecord) {
  const now = new Date().toISOString()
  const iso = (ms: number) => new Date(ms).toISOString()
  const metadata = {
    app: record.appName,
    app_id: record.appId,
    endpoint: record.endpoint,
    requested_model: record.requestedModel,
    provider: record.providerName,
    attempts: record.attempts,
    cache: record.cache,
    stream: record.stream,
    http_status: record.httpStatus,
    gateway_timings_ms: record.timings,
  }
  return {
    batch: [
      {
        id: randomUUID(),
        type: "trace-create",
        timestamp: now,
        body: {
          id: record.id,
          timestamp: iso(record.start),
          name: `${record.appName} · ${record.requestedModel ?? record.endpoint}`,
          tags: [record.appName, record.endpoint],
          metadata,
          ...(record.input !== undefined ? { input: record.input } : {}),
          ...(record.output !== undefined ? { output: record.output } : {}),
        },
      },
      {
        id: randomUUID(),
        type: "generation-create",
        timestamp: now,
        body: {
          id: `${record.id}-generation`,
          traceId: record.id,
          name: record.servedModel ?? record.requestedModel ?? "request",
          startTime: iso(record.start),
          ...(record.firstTokenAt
            ? { completionStartTime: iso(record.firstTokenAt) }
            : {}),
          endTime: iso(record.end),
          model: record.upstreamModel ?? record.requestedModel ?? undefined,
          modelParameters: record.parameters,
          usageDetails: {
            input: record.inputTokens,
            output: record.outputTokens,
            total: record.inputTokens + record.outputTokens,
            ...(record.cachedTokens
              ? { input_cached_tokens: record.cachedTokens }
              : {}),
            ...(record.reasoningTokens
              ? { output_reasoning_tokens: record.reasoningTokens }
              : {}),
          },
          costDetails: { total: record.costUsd },
          level: record.ok ? "DEFAULT" : "ERROR",
          ...(record.error ? { statusMessage: record.error } : {}),
          metadata,
          ...(record.input !== undefined ? { input: record.input } : {}),
          ...(record.output !== undefined ? { output: record.output } : {}),
        },
      },
    ],
  }
}

async function sendLangfuse(
  settings: NonNullable<ExportSettings["langfuse"]>,
  record: TraceRecord
): Promise<void> {
  const auth = Buffer.from(
    `${settings.publicKey}:${decryptSecret(settings.secret)}`
  ).toString("base64")
  const response = await publicFetch(
    `${settings.host.replace(/\/$/, "")}/api/public/ingestion`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(langfuseBatch(record)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  )
  const text = await response.text().catch(() => "")
  if (response.status === 401 || response.status === 403)
    throw new Error(
      "Langfuse rejected the keys (check the public and secret key and the region)"
    )
  if (!response.ok)
    throw new Error(
      `Langfuse answered HTTP ${response.status}: ${text.slice(0, 200)}`
    )
  // 207: per-event results.
  const errors = (() => {
    try {
      return (
        (
          JSON.parse(text) as {
            errors?: { message?: string; error?: string }[]
          }
        ).errors ?? []
      )
    } catch {
      return []
    }
  })()
  if (errors.length)
    throw new Error(
      `Langfuse refused the trace: ${String(errors[0]!.message ?? errors[0]!.error ?? "unknown error").slice(0, 200)}`
    )
}

// ---------------------------------------------------------------------------
// OpenTelemetry (OTLP/HTTP JSON, GenAI semantic conventions)
// ---------------------------------------------------------------------------

type OtelValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }

function attribute(
  key: string,
  value: unknown
): { key: string; value: OtelValue } | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return { key, value: { boolValue: value } }
  if (typeof value === "number")
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } }
  return {
    key,
    value: {
      stringValue: (typeof value === "string"
        ? value
        : JSON.stringify(value)
      ).slice(0, 32_000),
    },
  }
}

const nanos = (ms: number) => `${BigInt(Math.round(ms)) * BigInt(1_000_000)}`

/** "/v1/traces" is added unless the URL already ends with it. */
export function otelTracesUrl(endpoint: string): string {
  const url = endpoint.replace(/\/$/, "")
  return url.endsWith("/v1/traces") ? url : `${url}/v1/traces`
}

/** Parses "key=value,key2=value2" (the OTEL_EXPORTER_OTLP_HEADERS format) or one per line. */
export function parseOtelHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const part of raw.split(/[\n,]/)) {
    const index = part.indexOf("=")
    if (index <= 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key && value) headers[key] = decodeURIComponent(value)
  }
  return headers
}

export function otelPayload(record: TraceRecord) {
  const operation = record.endpoint === "embeddings" ? "embeddings" : "chat"
  const attributes = [
    attribute("gen_ai.operation.name", operation),
    attribute("gen_ai.system", record.providerType),
    attribute("gen_ai.request.model", record.requestedModel),
    attribute("gen_ai.response.model", record.upstreamModel),
    attribute("gen_ai.usage.input_tokens", record.inputTokens),
    attribute("gen_ai.usage.output_tokens", record.outputTokens),
    ...Object.entries(record.parameters).map(([key, value]) =>
      attribute(`gen_ai.request.${key}`, value)
    ),
    attribute("gateway.app.name", record.appName),
    attribute("gateway.app.id", record.appId),
    attribute("gateway.endpoint", record.endpoint),
    attribute("gateway.model", record.servedModel),
    attribute("gateway.provider", record.providerName),
    attribute("gateway.attempts", record.attempts),
    attribute("gateway.cache", record.cache),
    attribute("gateway.stream", record.stream),
    attribute("gateway.cost_usd", record.costUsd),
    attribute("gateway.cached_tokens", record.cachedTokens),
    attribute("gateway.reasoning_tokens", record.reasoningTokens),
    attribute("gateway.overhead_ms", record.timings.overhead),
    attribute("http.response.status_code", record.httpStatus),
    attribute("gen_ai.input.messages", record.input),
    attribute("gen_ai.output.messages", record.output),
    attribute("error.type", record.ok ? null : String(record.httpStatus)),
  ].filter((entry) => entry !== null)

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attribute("service.name", "llm-gateway")],
        },
        scopeSpans: [
          {
            scope: { name: "llm-gateway" },
            spans: [
              {
                traceId: record.id.replaceAll("-", ""),
                spanId: randomBytes(8).toString("hex"),
                name: `${operation} ${record.requestedModel ?? ""}`.trim(),
                kind: 3,
                startTimeUnixNano: nanos(record.start),
                endTimeUnixNano: nanos(record.end),
                attributes,
                events: record.firstTokenAt
                  ? [
                      {
                        name: "gen_ai.first_token",
                        timeUnixNano: nanos(record.firstTokenAt),
                      },
                    ]
                  : [],
                status: record.ok
                  ? { code: 1 }
                  : { code: 2, message: record.error ?? "" },
              },
            ],
          },
        ],
      },
    ],
  }
}

async function sendOtel(
  settings: NonNullable<ExportSettings["otel"]>,
  record: TraceRecord
): Promise<void> {
  const headers = settings.headersSecret
    ? parseOtelHeaders(decryptSecret(settings.headersSecret))
    : {}
  const response = await publicFetch(otelTracesUrl(settings.endpoint), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(otelPayload(record)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text().catch(() => "")
  if (!response.ok)
    throw new Error(
      `The collector answered HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
    )
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|aborted/i.test(message)
    ? "No answer within 5 seconds"
    : message.slice(0, 300)
}

/** Sends to every enabled destination; returns the first failure, if any. */
export async function sendTrace(
  settings: ExportSettings,
  record: TraceRecord
): Promise<{ langfuse?: string; otel?: string }> {
  const [langfuse, otel] = await Promise.allSettled([
    settings.langfuse ? sendLangfuse(settings.langfuse, record) : null,
    settings.otel ? sendOtel(settings.otel, record) : null,
  ])
  return {
    ...(langfuse.status === "rejected"
      ? { langfuse: describe(langfuse.reason) }
      : {}),
    ...(otel.status === "rejected" ? { otel: describe(otel.reason) } : {}),
  }
}

/** After a request: export it if the app's owner set up a destination. */
export async function exportTrace(
  recorder: RequestRecorder,
  auth: AuthContext
): Promise<void> {
  try {
    const email = auth.app.owner_email
    const settings = await loadExportSettings(email)
    if (!settings) return
    const failures = await sendTrace(settings, traceRecord(recorder, auth))
    const failed = failures.langfuse
      ? `Langfuse: ${failures.langfuse}`
      : failures.otel
        ? `OpenTelemetry: ${failures.otel}`
        : null
    // Record the outcome at most once a minute per person.
    const last = lastStatusWrite.get(email) ?? 0
    if (Date.now() - last < ERROR_WRITE_MS) return
    if (lastStatusWrite.size >= MAX_ENTRIES) lastStatusWrite.clear()
    lastStatusWrite.set(email, Date.now())
    const now = new Date().toISOString()
    await supabaseAdmin()
      .from("trace_exports")
      .update(
        failed
          ? { last_error: failed, last_error_at: now }
          : { last_success_at: now }
      )
      .eq("owner_email", email)
  } catch (error) {
    console.error("[gateway] trace export failed:", error)
  }
}

export type { ExportSettings }
