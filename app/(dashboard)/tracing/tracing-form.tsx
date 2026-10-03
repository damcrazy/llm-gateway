"use client"

import { useState, useTransition } from "react"
import { SaveIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

import { saveTraceExports, sendTestTrace } from "./actions"
import { LANGFUSE_CUSTOM, LANGFUSE_HOSTS, type TraceExportView } from "./shared"

export function TracingForm({ initial }: { initial: TraceExportView }) {
  const knownHost = LANGFUSE_HOSTS.some(
    (option) => option.value === initial.langfuse.host
  )
  const [lfEnabled, setLfEnabled] = useState(initial.langfuse.enabled)
  const [region, setRegion] = useState<string>(
    knownHost || !initial.langfuse.host
      ? initial.langfuse.host || LANGFUSE_HOSTS[0].value
      : LANGFUSE_CUSTOM
  )
  const [customHost, setCustomHost] = useState(
    knownHost ? "" : initial.langfuse.host
  )
  const [publicKey, setPublicKey] = useState(initial.langfuse.publicKey)
  const [secretKey, setSecretKey] = useState("")
  const [hasSecret, setHasSecret] = useState(initial.langfuse.hasSecret)

  const [otelEnabled, setOtelEnabled] = useState(initial.otel.enabled)
  const [endpoint, setEndpoint] = useState(initial.otel.endpoint)
  const [headers, setHeaders] = useState("")
  const [headersHint, setHeadersHint] = useState(initial.otel.headersHint)
  const [editingHeaders, setEditingHeaders] = useState(
    !initial.otel.headersHint
  )

  const [pending, startTransition] = useTransition()
  const [testing, startTesting] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveTraceExports({
        langfuse: {
          enabled: lfEnabled,
          host: region === LANGFUSE_CUSTOM ? customHost.trim() : region,
          publicKey,
          secretKey: secretKey.trim() || undefined,
        },
        otel: {
          enabled: otelEnabled,
          endpoint,
          headers: editingHeaders ? headers : undefined,
        },
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (secretKey.trim()) {
        setHasSecret(true)
        setSecretKey("")
      }
      if (editingHeaders) {
        const names = headers
          .split(/[\n,]/)
          .map((line) => line.split("=")[0]?.trim().toLowerCase())
          .filter(Boolean)
        setHeadersHint(names.length ? names.join(", ") : null)
        setHeaders("")
        setEditingHeaders(!names.length)
      }
      toast.success(result.message)
    })
  }

  function test() {
    startTesting(async () => {
      const result = await sendTestTrace()
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Langfuse</CardTitle>
          <CardDescription>
            Each request becomes a trace with one generation: model, tokens,
            cost, timings, and first-token time.
          </CardDescription>
          <CardAction>
            <Switch
              checked={lfEnabled}
              onCheckedChange={setLfEnabled}
              aria-label="Send traces to Langfuse"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lf-region">Where</FieldLabel>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger id="lf-region">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {LANGFUSE_HOSTS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={LANGFUSE_CUSTOM}>Self-hosted</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {region === LANGFUSE_CUSTOM && (
                <Field>
                  <FieldLabel htmlFor="lf-host">Langfuse URL</FieldLabel>
                  <Input
                    id="lf-host"
                    type="url"
                    placeholder="https://langfuse.example.com"
                    value={customHost}
                    onChange={(event) => setCustomHost(event.target.value)}
                  />
                </Field>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lf-public">Public key</FieldLabel>
                <Input
                  id="lf-public"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder="pk-lf-…"
                  value={publicKey}
                  onChange={(event) => setPublicKey(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="lf-secret">Secret key</FieldLabel>
                <Input
                  id="lf-secret"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  className="font-mono"
                  placeholder={hasSecret ? "Saved; type to replace" : "sk-lf-…"}
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.target.value)}
                />
              </Field>
            </div>
            <FieldDescription>
              From your Langfuse project&apos;s Settings → API keys. The secret
              key is stored encrypted and never shown again.
            </FieldDescription>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenTelemetry</CardTitle>
          <CardDescription>
            One span per request using the GenAI semantic conventions, sent as
            OTLP/HTTP JSON. Works with Honeycomb, Grafana Cloud, Datadog,
            Jaeger, Phoenix and other collectors.
          </CardDescription>
          <CardAction>
            <Switch
              checked={otelEnabled}
              onCheckedChange={setOtelEnabled}
              aria-label="Send spans to an OpenTelemetry collector"
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="otel-endpoint">OTLP/HTTP URL</FieldLabel>
              <Input
                id="otel-endpoint"
                type="url"
                spellCheck={false}
                placeholder="https://api.honeycomb.io"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
              />
              <FieldDescription>
                <code className="font-mono text-xs">/v1/traces</code> is added
                unless the URL already ends with it. Must be https.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="otel-headers">Headers</FieldLabel>
              {editingHeaders ? (
                <Textarea
                  id="otel-headers"
                  spellCheck={false}
                  className="min-h-20 font-mono text-sm"
                  placeholder={"x-honeycomb-team=your-api-key"}
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border bg-muted px-2 py-1.5 font-mono text-sm">
                    {headersHint}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingHeaders(true)}
                  >
                    Replace
                  </Button>
                </div>
              )}
              <FieldDescription>
                Usually the API key, as name=value, one per line (or
                comma-separated, like OTEL_EXPORTER_OTLP_HEADERS). Stored
                encrypted; only the names are shown again.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-between gap-2 border-t">
          <Button
            type="button"
            variant="outline"
            disabled={testing || pending}
            onClick={test}
          >
            {testing ? <Spinner /> : <SendIcon />}
            Send test trace
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : <SaveIcon />}
            Save
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
