import type { Metadata } from "next"
import { CircleCheckIcon, CircleXIcon, InfoIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireMember } from "@/lib/auth"
import { formatDateTime, formatRelative } from "@/lib/format"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getTimeZone } from "@/lib/time-zone-server"

import type { TraceExportView } from "./shared"
import { TracingForm } from "./tracing-form"

export const metadata: Metadata = { title: "Tracing" }

export default async function TracingPage() {
  const me = await requireMember()
  const timeZone = await getTimeZone()
  const { data } = await supabaseAdmin()
    .from("trace_exports")
    .select(
      "langfuse_enabled, langfuse_host, langfuse_public_key, langfuse_secret, otel_enabled, otel_endpoint, otel_headers_hint, last_success_at, last_error, last_error_at"
    )
    .eq("owner_email", me.email)
    .maybeSingle()

  const view: TraceExportView = {
    langfuse: {
      enabled: Boolean(data?.langfuse_enabled),
      host: (data?.langfuse_host as string | null) ?? "",
      publicKey: (data?.langfuse_public_key as string | null) ?? "",
      hasSecret: Boolean(data?.langfuse_secret),
    },
    otel: {
      enabled: Boolean(data?.otel_enabled),
      endpoint: (data?.otel_endpoint as string | null) ?? "",
      headersHint: (data?.otel_headers_hint as string | null) ?? null,
    },
    lastSuccessAt: (data?.last_success_at as string | null) ?? null,
    lastError: (data?.last_error as string | null) ?? null,
    lastErrorAt: (data?.last_error_at as string | null) ?? null,
  }
  const active = view.langfuse.enabled || view.otel.enabled
  const failing =
    view.lastError &&
    (!view.lastSuccessAt ||
      new Date(view.lastErrorAt ?? 0) > new Date(view.lastSuccessAt))

  return (
    <>
      <PageTour id="tracing" />
      <PageHeader
        title="Tracing"
        description="Send every request from your apps to Langfuse or an OpenTelemetry collector."
      />
      <div className="grid max-w-3xl gap-6">
        {active && failing ? (
          <Alert data-tour="tracing-status" variant="destructive">
            <CircleXIcon />
            <AlertTitle>
              The last export failed {formatRelative(view.lastErrorAt)}
            </AlertTitle>
            <AlertDescription>{view.lastError}</AlertDescription>
          </Alert>
        ) : active && view.lastSuccessAt ? (
          <Alert data-tour="tracing-status">
            <CircleCheckIcon />
            <AlertTitle>Exporting</AlertTitle>
            <AlertDescription>
              Last trace sent {formatRelative(view.lastSuccessAt)} (
              {formatDateTime(view.lastSuccessAt, timeZone)}).
            </AlertDescription>
          </Alert>
        ) : null}
        <Alert data-tour="tracing-what">
          <InfoIcon />
          <AlertTitle>What is sent</AlertTitle>
          <AlertDescription>
            Traces are sent after the response, so they add no latency. They
            include the app, the model asked for and the one that answered,
            tokens, cost, timings and errors. Prompts and answers are included
            only for apps with &ldquo;Log full payloads&rdquo; turned on.
            Changes apply within a minute.
          </AlertDescription>
        </Alert>
        <TracingForm initial={view} />
      </div>
    </>
  )
}
