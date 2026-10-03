import { describe, expect, test } from "bun:test"

import {
  langfuseBatch,
  otelPayload,
  otelTracesUrl,
  parseOtelHeaders,
  type TraceRecord,
} from "@/lib/gateway/export"

const record: TraceRecord = {
  id: "0b6f3c1e-1111-4222-8333-944445555666",
  appId: "app-1",
  appName: "Support bot",
  endpoint: "chat",
  requestedModel: "smart",
  servedModel: "gemini/flash",
  upstreamModel: "models/gemini-2.5-flash",
  providerName: "Gemini",
  providerType: "google_ai_studio",
  start: 1_700_000_000_000,
  end: 1_700_000_001_500,
  firstTokenAt: 1_700_000_000_400,
  ok: true,
  httpStatus: 200,
  error: null,
  stream: true,
  attempts: 2,
  cache: "MISS",
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 10,
  reasoningTokens: 5,
  costUsd: 0.0012,
  timings: { total: 1500, prepare: 2, overhead: 8, provider: 1490 },
  parameters: { temperature: 0.3, max_tokens: 200 },
}

describe("langfuseBatch", () => {
  test("a trace and a generation with usage, cost and timings", () => {
    const { batch } = langfuseBatch(record)
    expect(batch.map((event) => event.type)).toEqual([
      "trace-create",
      "generation-create",
    ])
    const trace = batch[0]!.body as Record<string, unknown>
    const generation = batch[1]!.body as Record<string, unknown>
    expect(trace.id).toBe(record.id)
    expect(trace.name).toBe("Support bot · smart")
    expect(generation.traceId).toBe(record.id)
    expect(generation.model).toBe("models/gemini-2.5-flash")
    expect(generation.startTime).toBe(new Date(record.start).toISOString())
    expect(generation.completionStartTime).toBe(
      new Date(record.firstTokenAt!).toISOString()
    )
    expect(generation.usageDetails).toEqual({
      input: 100,
      output: 20,
      total: 120,
      input_cached_tokens: 10,
      output_reasoning_tokens: 5,
    })
    expect(generation.costDetails).toEqual({ total: 0.0012 })
    expect(generation.modelParameters).toEqual({
      temperature: 0.3,
      max_tokens: 200,
    })
    expect(generation.level).toBe("DEFAULT")
    expect("input" in generation).toBe(false)
  })

  test("errors and payloads", () => {
    const { batch } = langfuseBatch({
      ...record,
      ok: false,
      httpStatus: 502,
      error: "upstream died",
      input: [{ role: "user", content: "hi" }],
      output: { role: "assistant", content: "yo" },
    })
    const generation = batch[1]!.body as Record<string, unknown>
    expect(generation.level).toBe("ERROR")
    expect(generation.statusMessage).toBe("upstream died")
    expect(generation.input).toEqual([{ role: "user", content: "hi" }])
    expect((batch[0]!.body as Record<string, unknown>).output).toEqual({
      role: "assistant",
      content: "yo",
    })
  })
})

describe("otelPayload", () => {
  test("one client span with GenAI attributes", () => {
    const span = otelPayload(record).resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.traceId).toBe(record.id.replaceAll("-", ""))
    expect(span.traceId).toHaveLength(32)
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(span.kind).toBe(3)
    expect(span.name).toBe("chat smart")
    expect(span.startTimeUnixNano).toBe("1700000000000000000")
    expect(span.endTimeUnixNano).toBe("1700000001500000000")
    expect(span.status).toEqual({ code: 1 })
    expect(span.events).toEqual([
      { name: "gen_ai.first_token", timeUnixNano: "1700000000400000000" },
    ])
    const attributes = Object.fromEntries(
      span.attributes.map((a) => [a!.key, Object.values(a!.value)[0]])
    )
    expect(attributes["gen_ai.request.model"]).toBe("smart")
    expect(attributes["gen_ai.response.model"]).toBe("models/gemini-2.5-flash")
    expect(attributes["gen_ai.usage.input_tokens"]).toBe("100")
    expect(attributes["gen_ai.request.temperature"]).toBe(0.3)
    expect(attributes["gateway.cost_usd"]).toBe(0.0012)
    expect(attributes["gateway.stream"]).toBe(true)
    expect("gen_ai.input.messages" in attributes).toBe(false)
    expect("error.type" in attributes).toBe(false)
  })

  test("failed request", () => {
    const span = otelPayload({
      ...record,
      ok: false,
      httpStatus: 429,
      error: "quota",
    }).resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(span.status).toEqual({ code: 2, message: "quota" })
  })
})

describe("OTLP helpers", () => {
  test("traces URL", () => {
    expect(otelTracesUrl("https://api.honeycomb.io")).toBe(
      "https://api.honeycomb.io/v1/traces"
    )
    expect(otelTracesUrl("https://otlp.example.com/otlp/")).toBe(
      "https://otlp.example.com/otlp/v1/traces"
    )
    expect(otelTracesUrl("https://x.io/v1/traces")).toBe(
      "https://x.io/v1/traces"
    )
  })

  test("headers: env-var style, one per line, values with = and escapes", () => {
    expect(parseOtelHeaders("x-honeycomb-team=abc,x-dataset=prod")).toEqual({
      "x-honeycomb-team": "abc",
      "x-dataset": "prod",
    })
    expect(
      parseOtelHeaders("Authorization=Basic dXNlcjpwYXNz==\n\nbad line")
    ).toEqual({
      Authorization: "Basic dXNlcjpwYXNz==",
    })
    expect(parseOtelHeaders("Authorization=Bearer%20tok")).toEqual({
      Authorization: "Bearer tok",
    })
  })
})
