"use client"

import { useState, useTransition } from "react"
import { SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { AppRow, PiiMode } from "@/lib/db/types"

import { updateAppSettings } from "../actions"

type SettingsApp = Pick<
  AppRow,
  | "id"
  | "name"
  | "description"
  | "monthly_budget_usd"
  | "rpm_limit"
  | "tpm_limit"
  | "pii_mode"
  | "json_guard"
  | "log_payloads"
  | "cache_ttl_seconds"
>

const PII_OPTIONS: { value: PiiMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "redact", label: "Redact" },
  { value: "block", label: "Block" },
]

const CACHE_OFF = "off"
const CACHE_OPTIONS = [
  { value: CACHE_OFF, label: "Off" },
  { value: "300", label: "5 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
]

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : Number(trimmed)
}

export function AppSettingsForm({ app }: { app: SettingsApp }) {
  const [name, setName] = useState(app.name)
  const [description, setDescription] = useState(app.description ?? "")
  const [budget, setBudget] = useState(
    app.monthly_budget_usd == null ? "" : String(Number(app.monthly_budget_usd))
  )
  const [rpm, setRpm] = useState(
    app.rpm_limit == null ? "" : String(app.rpm_limit)
  )
  const [tpm, setTpm] = useState(
    app.tpm_limit == null ? "" : String(app.tpm_limit)
  )
  const [piiMode, setPiiMode] = useState<PiiMode>(app.pii_mode)
  const [jsonGuard, setJsonGuard] = useState(app.json_guard)
  const [logPayloads, setLogPayloads] = useState(app.log_payloads)
  const [cacheTtl, setCacheTtl] = useState(
    app.cache_ttl_seconds == null ? CACHE_OFF : String(app.cache_ttl_seconds)
  )
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateAppSettings(app.id, {
        name,
        description,
        monthlyBudgetUsd: parseOptionalNumber(budget),
        rpmLimit: parseOptionalNumber(rpm),
        tpmLimit: parseOptionalNumber(tpm),
        piiMode,
        jsonGuard,
        logPayloads,
        cacheTtlSeconds: cacheTtl === CACHE_OFF ? null : Number(cacheTtl),
      })
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Limits and defaults applied to every request made with this
            app&apos;s keys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <div className="grid gap-6 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                <Input
                  id="settings-name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-description">
                  Description
                </FieldLabel>
                <Textarea
                  id="settings-description"
                  rows={1}
                  maxLength={500}
                  className="min-h-9"
                  placeholder="What is this app for?"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </div>

            <FieldSeparator />

            <div
              className="grid gap-6 md:grid-cols-3"
              data-tour="app-settings-limits"
            >
              <Field>
                <FieldLabel htmlFor="settings-budget">
                  Monthly budget
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>$</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="settings-budget"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    placeholder="No limit"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>USD</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Requests are rejected once this calendar month&apos;s spend
                  reaches it.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-rpm">Rate limit</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="settings-rpm"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="No limit"
                    value={rpm}
                    onChange={(event) => setRpm(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>requests / min</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Shared by all of this app&apos;s keys.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-tpm">Token limit</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="settings-tpm"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="No limit"
                    value={tpm}
                    onChange={(event) => setTpm(event.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>tokens / min</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Input plus output. Once reached, requests wait for the next
                  minute.
                </FieldDescription>
              </Field>
            </div>

            <FieldSeparator />

            <Field orientation="horizontal" data-tour="app-settings-cache">
              <FieldContent>
                <FieldLabel htmlFor="settings-cache">Response cache</FieldLabel>
                <FieldDescription>
                  An identical request (same model or bucket, messages, tools
                  and settings) gets the stored answer instantly, at no cost.
                  Answers are kept in the gateway&apos;s database for this long.
                  Clients can skip it with{" "}
                  <code className="font-mono text-xs">
                    Cache-Control: no-cache
                  </code>
                  .
                </FieldDescription>
              </FieldContent>
              <Select value={cacheTtl} onValueChange={setCacheTtl}>
                <SelectTrigger id="settings-cache" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {CACHE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="horizontal" data-tour="app-settings-pii">
              <FieldContent>
                <FieldLabel htmlFor="settings-pii">
                  Personal data in prompts
                </FieldLabel>
                <FieldDescription>
                  Finds email addresses, phone numbers, card and bank numbers,
                  US social security numbers and API keys or secrets.{" "}
                  <strong className="font-medium text-foreground">
                    Redact
                  </strong>{" "}
                  replaces them with placeholders like [EMAIL] before any
                  provider sees them, and in logs and traces;{" "}
                  <strong className="font-medium text-foreground">Block</strong>{" "}
                  refuses the request.
                </FieldDescription>
              </FieldContent>
              <Select
                value={piiMode}
                onValueChange={(value) => setPiiMode(value as PiiMode)}
              >
                <SelectTrigger id="settings-pii" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {PII_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="horizontal" data-tour="app-settings-json">
              <FieldContent>
                <FieldLabel htmlFor="settings-json-guard">
                  Check structured output
                </FieldLabel>
                <FieldDescription>
                  When a request asks for JSON (
                  <code className="font-mono text-xs">response_format</code>{" "}
                  json_object or json_schema), check the answer is valid JSON
                  that matches the schema. If not, the next model in the bucket
                  answers instead, and the same model gets one more try if
                  it&apos;s the last. Answers wrapped in ```json fences are
                  unwrapped. Not for streaming requests.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-json-guard"
                checked={jsonGuard}
                onCheckedChange={setJsonGuard}
              />
            </Field>

            <Field orientation="horizontal" data-tour="app-settings-payloads">
              <FieldContent>
                <FieldLabel htmlFor="settings-log-payloads">
                  Log full payloads
                </FieldLabel>
                <FieldDescription>
                  Store prompts and responses for each request so you can
                  inspect them in Logs. Payloads are kept for 7 days.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="settings-log-payloads"
                checked={logPayloads}
                onCheckedChange={setLogPayloads}
              />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter
          className="justify-end border-t"
          data-tour="app-settings-save"
        >
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? <Spinner /> : <SaveIcon />}
            Save settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
