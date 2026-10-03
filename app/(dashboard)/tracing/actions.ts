"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember } from "@/lib/auth"
import { encryptSecret } from "@/lib/crypto"
import {
  forgetExportSettings,
  loadExportSettings,
  parseOtelHeaders,
  sendTrace,
  type TraceRecord,
} from "@/lib/gateway/export"
import { checkPublicUrl } from "@/lib/net/public-fetch"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { LANGFUSE_HOSTS } from "./shared"

const schema = z.object({
  langfuse: z.object({
    enabled: z.boolean(),
    host: z.string().trim().max(500),
    publicKey: z.string().trim().max(200),
    /** undefined keeps the saved secret key. */
    secretKey: z.string().trim().max(200).optional(),
  }),
  otel: z.object({
    enabled: z.boolean(),
    endpoint: z.string().trim().max(2000),
    /** undefined keeps the saved headers, "" removes them. */
    headers: z.string().max(8000).optional(),
  }),
})

export async function saveTraceExports(
  input: z.input<typeof schema>
): Promise<ActionResult> {
  const me = await requireMember()
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Check the export settings" }
  const { langfuse, otel } = parsed.data
  const db = supabaseAdmin()
  const { data: saved } = await db
    .from("trace_exports")
    .select("langfuse_secret, otel_headers_secret")
    .eq("owner_email", me.email)
    .maybeSingle()

  const row: Record<string, unknown> = {
    owner_email: me.email,
    langfuse_enabled: langfuse.enabled,
    langfuse_host: langfuse.host || null,
    langfuse_public_key: langfuse.publicKey || null,
    otel_enabled: otel.enabled,
    otel_endpoint: otel.endpoint || null,
    updated_at: new Date().toISOString(),
    // A new destination starts with a clean status.
    last_error: null,
    last_error_at: null,
  }
  if (langfuse.secretKey)
    row.langfuse_secret = encryptSecret(langfuse.secretKey)

  if (langfuse.enabled) {
    if (!langfuse.host)
      return { ok: false, error: "Choose your Langfuse region or URL" }
    if (!LANGFUSE_HOSTS.some((option) => option.value === langfuse.host)) {
      const problem = await checkPublicUrl(langfuse.host, "Trace exports")
      if (problem) return { ok: false, error: problem }
    }
    if (!langfuse.publicKey)
      return { ok: false, error: "Enter your Langfuse public key (pk-lf-…)" }
    if (!langfuse.secretKey && !saved?.langfuse_secret)
      return { ok: false, error: "Enter your Langfuse secret key (sk-lf-…)" }
  }

  if (otel.headers !== undefined) {
    const headers = otel.headers.trim()
    if (headers && !Object.keys(parseOtelHeaders(headers)).length)
      return { ok: false, error: "Write headers as name=value, one per line" }
    row.otel_headers_secret = headers ? encryptSecret(headers) : null
    row.otel_headers_hint = headers
      ? Object.keys(parseOtelHeaders(headers))
          .map((name) => name.toLowerCase())
          .join(", ")
      : null
  }
  if (otel.enabled) {
    if (!otel.endpoint)
      return { ok: false, error: "Enter your collector's OTLP/HTTP URL" }
    const problem = await checkPublicUrl(otel.endpoint, "Trace exports")
    if (problem) return { ok: false, error: problem }
  }

  try {
    const { error } = await db
      .from("trace_exports")
      .upsert(row, { onConflict: "owner_email" })
    if (error) return actionError(error)
  } catch (error) {
    return actionError(error)
  }
  forgetExportSettings(me.email)
  revalidatePath("/tracing")
  return { ok: true, message: "Export settings saved" }
}

/** Sends a made-up request to every enabled destination. */
export async function sendTestTrace(): Promise<ActionResult> {
  const me = await requireMember()
  const settings = await loadExportSettings(me.email, { fresh: true })
  if (!settings)
    return { ok: false, error: "Turn on and save a destination first" }
  const now = Date.now()
  const record: TraceRecord = {
    id: randomUUID(),
    appId: "00000000-0000-0000-0000-000000000000",
    appName: "Test",
    endpoint: "chat",
    requestedModel: "test",
    servedModel: "gateway/test",
    upstreamModel: "test",
    providerName: "LLM gateway",
    providerType: "test",
    start: now - 420,
    end: now,
    firstTokenAt: now - 300,
    ok: true,
    httpStatus: 200,
    error: null,
    stream: false,
    attempts: 1,
    cache: null,
    inputTokens: 12,
    outputTokens: 5,
    cachedTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    timings: { total: 420, prepare: 3, overhead: 9, provider: 411 },
    parameters: {},
    input: [{ role: "user", content: "Test trace from your LLM gateway" }],
    output: { role: "assistant", content: "It works." },
  }
  const failures = await sendTrace(settings, record)
  const sent = [
    settings.langfuse && !failures.langfuse ? "Langfuse" : null,
    settings.otel && !failures.otel ? "OpenTelemetry" : null,
  ].filter(Boolean)
  const failed = [
    failures.langfuse ? `Langfuse: ${failures.langfuse}` : null,
    failures.otel ? `OpenTelemetry: ${failures.otel}` : null,
  ].filter(Boolean)
  const nowIso = new Date().toISOString()
  await supabaseAdmin()
    .from("trace_exports")
    .update(
      failed.length
        ? { last_error: failed.join(" · "), last_error_at: nowIso }
        : { last_success_at: nowIso, last_error: null, last_error_at: null }
    )
    .eq("owner_email", me.email)
  revalidatePath("/tracing")
  if (failed.length) return { ok: false, error: failed.join(" · ") }
  return { ok: true, message: `Test trace sent to ${sent.join(" and ")}` }
}
