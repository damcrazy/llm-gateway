import { APICallError } from "@ai-sdk/provider"

/** An error the gateway returns to its client. */
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly type: string = status >= 500
      ? "api_error"
      : "invalid_request_error",
    readonly headers: Record<string, string> = {}
  ) {
    super(message)
    this.name = "GatewayError"
  }
}

/** An error returned by (or while reaching) an upstream provider. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null for network errors and timeouts. */
    readonly status: number | null,
    readonly options: {
      retryAfterMs?: number
      body?: string
      /**
       * "output": the answer failed the structured-output guard.
       * "mismatch": the answer doesn't fit the request, e.g. embeddings of
       * another size than `dimensions`.
       */
      kind?:
        | "http"
        | "network"
        | "timeout"
        | "config"
        | "stream"
        | "output"
        | "mismatch"
    } = {}
  ) {
    super(message)
    this.name = "UpstreamError"
  }

  get kind() {
    return this.options.kind ?? (this.status == null ? "network" : "http")
  }
}

/** The client went away; stop without failing over or penalising the model. */
export class ClientAbortError extends Error {
  constructor() {
    super("Client closed the request")
    this.name = "ClientAbortError"
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
}

/** Parses Retry-After / retry-after-ms / x-ratelimit-reset-* headers into ms. */
export function retryAfterMs(
  headers: Headers | Record<string, string> | undefined
): number | undefined {
  if (!headers) return undefined
  const get = (name: string) =>
    headers instanceof Headers
      ? headers.get(name)
      : (headers[name] ?? headers[name.toLowerCase()])

  const ms = Number(get("retry-after-ms"))
  if (Number.isFinite(ms) && ms > 0) return ms

  const retryAfter = get("retry-after")
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return seconds * 1000
    const date = Date.parse(retryAfter)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }

  // OpenAI / Groq style: "6m0s", "1.5s", "250ms"
  for (const name of [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
  ]) {
    const parsed = parseDuration(get(name))
    if (parsed) return parsed
  }
  return undefined
}

function parseDuration(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) return asNumber * 1000
  let total = 0
  let matched = false
  for (const [, amount, unit] of value.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    matched = true
    const n = Number(amount)
    total +=
      unit === "h"
        ? n * 3_600_000
        : unit === "m"
          ? n * 60_000
          : unit === "s"
            ? n * 1000
            : n
  }
  return matched ? total : undefined
}

export async function upstreamErrorFromResponse(
  response: Response
): Promise<UpstreamError> {
  const body = await response.text().catch(() => "")
  return new UpstreamError(
    extractErrorMessage(body) ?? `HTTP ${response.status}`,
    response.status,
    {
      retryAfterMs: retryAfterMs(response.headers),
      body: body.slice(0, 4000),
    }
  )
}

export function extractErrorMessage(body: string): string | undefined {
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const error =
      (Array.isArray(parsed) ? parsed[0]?.error : parsed.error) ?? parsed
    if (typeof error === "string") return error
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message
      if (typeof message === "string") return message
    }
    if (typeof parsed.message === "string") return parsed.message
    if (typeof parsed.detail === "string") return parsed.detail
  } catch {
    // not JSON
  }
  return body.slice(0, 500)
}

/** Converts anything thrown by an adapter into an UpstreamError. */
export function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error
  if (APICallError.isInstance(error)) {
    return new UpstreamError(
      (error.responseBody && extractErrorMessage(error.responseBody)) ||
        error.message,
      error.statusCode ?? null,
      {
        retryAfterMs: retryAfterMs(error.responseHeaders),
        body: error.responseBody?.slice(0, 4000),
      }
    )
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new UpstreamError(error.message || "Upstream timed out", null, {
      kind: "timeout",
    })
  }
  if (error instanceof Error) {
    if (CONFIG_ERRORS.has(error.name)) {
      return new UpstreamError(error.message, null, { kind: "config" })
    }
    // Bad request shapes the provider SDK refused to send: try the next model.
    if (REQUEST_ERRORS.has(error.name)) {
      return new UpstreamError(error.message, 400)
    }
    return new UpstreamError(error.message, null, { kind: "network" })
  }
  return new UpstreamError(String(error), null)
}

const CONFIG_ERRORS = new Set([
  "AI_LoadAPIKeyError",
  "AI_LoadSettingError",
  "AI_NoSuchModelError",
  "ConfigError",
])

const REQUEST_ERRORS = new Set([
  "AI_InvalidArgumentError",
  "AI_InvalidPromptError",
  "AI_UnsupportedFunctionalityError",
  "AI_TypeValidationError",
])
