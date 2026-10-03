"use client"

import { useState, useTransition } from "react"
import { SaveIcon, SendIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Button } from "@/components/ui/button"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import { saveAlertSettings, sendTestAlert, testWebhook } from "./actions"
import { BUDGET_OPTIONS, LATENCY_OFF, LATENCY_OPTIONS } from "./shared"

export function AlertSettingsForm({
  initial,
}: {
  initial: {
    budgetPercent: number
    notifyModelDown: boolean
    latencyThresholdMs: number | null
    webhookHint: string | null
  }
}) {
  const [budgetPercent, setBudgetPercent] = useState(
    String(initial.budgetPercent)
  )
  const [notifyModelDown, setNotifyModelDown] = useState(
    initial.notifyModelDown
  )
  const [latency, setLatency] = useState(
    initial.latencyThresholdMs
      ? String(initial.latencyThresholdMs)
      : LATENCY_OFF
  )
  const [webhookHint, setWebhookHint] = useState(initial.webhookHint)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [replacing, setReplacing] = useState(!initial.webhookHint)
  const [pending, startTransition] = useTransition()
  const [testing, startTesting] = useTransition()

  const budgetChoices = BUDGET_OPTIONS.includes(
    initial.budgetPercent as (typeof BUDGET_OPTIONS)[number]
  )
    ? BUDGET_OPTIONS
    : [...BUDGET_OPTIONS, initial.budgetPercent].sort((a, b) => a - b)
  const latencyChoices = LATENCY_OPTIONS.some((o) => o.value === latency)
    ? LATENCY_OPTIONS
    : [
        ...LATENCY_OPTIONS,
        { value: latency, label: `Above ${Number(latency) / 1000} s` },
      ]

  function save(webhook: string | null | undefined) {
    startTransition(async () => {
      const result = await saveAlertSettings({
        budgetPercent: Number(budgetPercent),
        notifyModelDown,
        latencyThresholdMs: latency === LATENCY_OFF ? null : Number(latency),
        webhookUrl: webhook,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (webhook === null) {
        setWebhookHint(null)
        setReplacing(true)
      } else if (webhook) {
        setWebhookHint(new URL(webhook).host)
        setWebhookUrl("")
        setReplacing(false)
      }
      toast.success(result.message)
    })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    save(replacing && webhookUrl.trim() ? webhookUrl.trim() : undefined)
  }

  function test() {
    startTesting(async () => {
      const result =
        replacing && webhookUrl.trim()
          ? await testWebhook(webhookUrl)
          : await sendTestAlert()
      if (result.ok) toast.success(result.message)
      else toast.error(result.error)
    })
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>What to alert on</CardTitle>
          <CardDescription>
            Each alert is raised once per period and shows in the bell at the
            top of the page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal" data-tour="alerts-budget">
              <FieldContent>
                <FieldLabel htmlFor="alert-budget">Budgets</FieldLabel>
                <FieldDescription>
                  When an app with a monthly budget (or your own account budget)
                  passes this share, and again when it&apos;s used up.
                </FieldDescription>
              </FieldContent>
              <Select value={budgetPercent} onValueChange={setBudgetPercent}>
                <SelectTrigger id="alert-budget" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {budgetChoices.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      At {value}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal" data-tour="alerts-latency">
              <FieldContent>
                <FieldLabel htmlFor="alert-latency">Slow responses</FieldLabel>
                <FieldDescription>
                  When an app&apos;s median response time (time to first token
                  when streaming) over 15 minutes goes above this. At most once
                  an hour per app.
                </FieldDescription>
              </FieldContent>
              <Select value={latency} onValueChange={setLatency}>
                <SelectTrigger id="alert-latency" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {latencyChoices.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal" data-tour="alerts-model-down">
              <FieldContent>
                <FieldLabel htmlFor="alert-model-down">
                  Failing models
                </FieldLabel>
                <FieldDescription>
                  When a model fails 3 times in a row or is taken out of
                  rotation (bad key, removed model). Covers your own providers;
                  admins also get shared ones. At most once an hour per model.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="alert-model-down"
                checked={notifyModelDown}
                onCheckedChange={setNotifyModelDown}
              />
            </Field>

            <FieldSeparator />

            <Field data-tour="alerts-webhook">
              <FieldLabel htmlFor="alert-webhook">Webhook</FieldLabel>
              {replacing ? (
                <Input
                  id="alert-webhook"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://hooks.slack.com/services/…"
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-md border bg-muted px-2 py-1.5 font-mono text-sm">
                    {webhookHint}/…
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReplacing(true)}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => save(null)}
                  >
                    <Trash2Icon />
                    Remove
                  </Button>
                </div>
              )}
              <FieldDescription>
                Optional. Alerts are also posted here as JSON: a Slack or
                Discord incoming-webhook URL works as is. Must be https. Stored
                encrypted.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter
          data-tour="alerts-actions"
          className="justify-between gap-2 border-t"
        >
          <Button
            type="button"
            variant="outline"
            disabled={testing}
            onClick={test}
          >
            {testing ? <Spinner /> : <SendIcon />}
            Send test alert
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
