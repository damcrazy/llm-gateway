"use client"

import Link from "next/link"
import { useRef, useState, useTransition } from "react"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  HistoryIcon,
  MessageSquareTextIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type {
  PlaygroundOptions,
  PlaygroundResult,
} from "@/lib/gateway/playground"
import { formatMs, formatNumber, formatUsd } from "@/lib/format"
import {
  MissingVariablesError,
  renderPrompt,
  type PromptMessage,
  type PromptRole,
} from "@/lib/prompt-template"

import {
  getPlaygroundOptions,
  sendPlaygroundMessage,
} from "../playground/actions"
import type { AppOption } from "../playground/playground-client"
import { MAX_COMPARE_MODELS, type ComparePrefill } from "./shared"

const NO_APP = "__none"

type Slot =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; result: PlaygroundResult }

const ROLE_LABELS: Record<PromptRole, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
}

function initialMessages(prefill: ComparePrefill | null): PromptMessage[] {
  if (prefill && prefill.source !== "error" && prefill.messages.length)
    return prefill.messages
  return [{ role: "user", content: "" }]
}

export function CompareClient({
  apps,
  canRunWithoutApp,
  initialAppId,
  initialOptions,
  initialModels,
  prefill,
}: {
  apps: AppOption[]
  canRunWithoutApp: boolean
  initialAppId: string | null
  initialOptions: PlaygroundOptions
  initialModels: string[]
  prefill: ComparePrefill | null
}) {
  const ready = prefill && prefill.source !== "error" ? prefill : null
  const [appId, setAppId] = useState(initialAppId)
  const [options, setOptions] = useState(initialOptions)
  const [loadingOptions, startLoadingOptions] = useTransition()
  const [models, setModels] = useState<string[]>(
    initialModels.length ? initialModels : [""]
  )
  const [messages, setMessages] = useState(() => initialMessages(prefill))
  const [variables, setVariables] = useState<Record<string, string>>(() =>
    Object.fromEntries((ready?.variables ?? []).map((name) => [name, ""]))
  )
  const [temperature, setTemperature] = useState(
    ready?.temperature != null ? String(ready.temperature) : ""
  )
  const [maxTokens, setMaxTokens] = useState(
    ready?.maxTokens != null ? String(ready.maxTokens) : ""
  )
  const [slots, setSlots] = useState<Record<number, Slot>>({})
  const runId = useRef(0)

  const names = [
    ...options.buckets.map((bucket) => bucket.name),
    ...options.routes.map((route) => route.name),
    ...options.modelGroups.flatMap((group) => group.models.map((m) => m.slug)),
  ]
  const running = Object.values(slots).some((slot) => slot.state === "running")
  const variableNames = Object.keys(variables)

  function changeApp(value: string) {
    const next = value === NO_APP ? null : value
    setAppId(next)
    startLoadingOptions(async () => {
      const result = await getPlaygroundOptions(next)
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Couldn't load models" : result.error)
        return
      }
      const loaded = result.data
      setOptions(loaded)
      const available = [
        ...loaded.buckets.map((bucket) => bucket.name),
        ...loaded.routes.map((route) => route.name),
        ...loaded.modelGroups.flatMap((g) => g.models.map((m) => m.slug)),
      ]
      setModels((current) =>
        current.map((model) => (available.includes(model) ? model : ""))
      )
    })
  }

  function updateMessage(index: number, patch: Partial<PromptMessage>) {
    setMessages((current) =>
      current.map((message, i) =>
        i === index ? { ...message, ...patch } : message
      )
    )
  }

  function run() {
    const chosen = models.map((model) => model.trim())
    if (!chosen.some(Boolean)) {
      toast.error("Pick at least one model")
      return
    }
    let rendered: PromptMessage[]
    try {
      rendered = variableNames.length
        ? renderPrompt(messages, variables)
        : messages
    } catch (error) {
      toast.error(
        error instanceof MissingVariablesError
          ? error.message
          : "Check the prompt"
      )
      return
    }
    const conversation = rendered.filter(
      (message) => message.content.trim() || message.role !== "system"
    )
    if (!conversation.some((m) => m.role === "user" && m.content.trim())) {
      toast.error("Write a user message first")
      return
    }
    const temp = temperature.trim() ? Number(temperature) : undefined
    const max = maxTokens.trim() ? Number(maxTokens) : undefined
    const id = ++runId.current
    setSlots(
      Object.fromEntries(
        chosen.map((model, index) => [
          index,
          model ? { state: "running" } : { state: "idle" },
        ])
      )
    )
    chosen.forEach((model, index) => {
      if (!model) return
      void sendPlaygroundMessage({
        model,
        messages: conversation,
        temperature: temp,
        maxTokens: max,
        appId,
      }).then((response) => {
        if (runId.current !== id) return
        const result: PlaygroundResult = response.ok
          ? response.data!
          : { ok: false, error: response.error, attempts: [], latencyMs: 0 }
        setSlots((current) => ({
          ...current,
          [index]: { state: "done", result },
        }))
      })
    })
  }

  const finished = Object.values(slots).flatMap((slot) =>
    slot.state === "done" && slot.result.ok ? [slot.result] : []
  )
  const fastest =
    finished.length > 1 ? Math.min(...finished.map((r) => r.latencyMs)) : null
  const priced = finished.filter((r) => r.costUsd != null)
  const cheapest =
    priced.length > 1 ? Math.min(...priced.map((r) => r.costUsd!)) : null

  return (
    <div className="grid min-w-0 gap-6">
      {prefill?.source === "error" && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Couldn&apos;t load that</AlertTitle>
          <AlertDescription>{prefill.error}</AlertDescription>
        </Alert>
      )}
      {ready && (
        <Alert>
          {ready.source === "replay" ? (
            <HistoryIcon />
          ) : (
            <MessageSquareTextIcon />
          )}
          <AlertTitle>{ready.label}</AlertTitle>
          <AlertDescription>
            {ready.source === "replay"
              ? "The conversation from the log is loaded below; the answers here are new. Images and files are shown as placeholders."
              : "Fill in the variables, pick models, and run. Your app calls this prompt by its slug."}
            {ready.truncated &&
              " Some long text was cut short when it was stored, so this isn't an exact copy."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>
            Up to {MAX_COMPARE_MODELS}. Buckets and routes use their fallback
            chain, just like your app.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-full sm:w-64">
              <FieldLabel htmlFor="compare-app">Run as</FieldLabel>
              <Select
                value={appId ?? NO_APP}
                onValueChange={changeApp}
                disabled={running}
              >
                <SelectTrigger id="compare-app" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {canRunWithoutApp && (
                    <SelectItem value={NO_APP}>No app (admin)</SelectItem>
                  )}
                  {apps.map((app) => (
                    <SelectItem key={app.id} value={app.id}>
                      {app.name}
                      {app.owner ? ` · ${app.owner}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {loadingOptions && <Spinner className="mb-2.5" />}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {models.map((model, index) => (
              <div key={index} className="flex items-end gap-1">
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor={`compare-model-${index}`}>
                    Model {index + 1}
                  </FieldLabel>
                  <Select
                    value={model}
                    onValueChange={(value) =>
                      setModels((current) =>
                        current.map((m, i) => (i === index ? value : m))
                      )
                    }
                    disabled={running}
                  >
                    <SelectTrigger
                      id={`compare-model-${index}`}
                      className="w-full font-mono text-xs"
                    >
                      <SelectValue placeholder="Pick a model" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-80">
                      {options.buckets.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>This app&apos;s buckets</SelectLabel>
                          {options.buckets.map((bucket) => (
                            <SelectItem
                              key={`b:${bucket.name}`}
                              value={bucket.name}
                            >
                              {bucket.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {options.routes.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Routes</SelectLabel>
                          {options.routes.map((route) => (
                            <SelectItem
                              key={`r:${route.name}`}
                              value={route.name}
                            >
                              {route.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {options.modelGroups.map((group) => (
                        <SelectGroup key={group.provider}>
                          <SelectLabel>{group.provider}</SelectLabel>
                          {group.models.map((m) => (
                            <SelectItem key={m.slug} value={m.slug}>
                              {m.slug}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {models.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove model ${index + 1}`}
                    disabled={running}
                    onClick={() => {
                      setModels((current) =>
                        current.filter((_, i) => i !== index)
                      )
                      setSlots({})
                    }}
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {models.length < MAX_COMPARE_MODELS && (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() =>
                  setModels((current) => [
                    ...current,
                    names.find((name) => !current.includes(name)) ?? "",
                  ])
                }
              >
                <PlusIcon />
                Add a model
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <CardDescription>
            Every model gets exactly these messages and settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {variableNames.length > 0 && (
            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="mb-0">
                Variables
              </FieldLegend>
              <div className="grid gap-3 sm:grid-cols-2">
                {variableNames.map((name) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`var-${name}`} className="font-mono">
                      {`{{${name}}}`}
                    </FieldLabel>
                    <Input
                      id={`var-${name}`}
                      value={variables[name]}
                      onChange={(event) =>
                        setVariables((current) => ({
                          ...current,
                          [name]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
            </FieldSet>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]"
            >
              <Select
                value={message.role}
                onValueChange={(value) =>
                  updateMessage(index, { role: value as PromptRole })
                }
              >
                <SelectTrigger
                  aria-label={`Role of message ${index + 1}`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {(Object.keys(ROLE_LABELS) as PromptRole[]).map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                aria-label={`Message ${index + 1}`}
                className="min-h-20"
                placeholder={
                  message.role === "system"
                    ? "Instructions for the model"
                    : "Write a message"
                }
                value={message.content}
                onChange={(event) =>
                  updateMessage(index, { content: event.target.value })
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault()
                    if (!running) run()
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove message ${index + 1}`}
                disabled={messages.length === 1}
                onClick={() =>
                  setMessages((current) =>
                    current.filter((_, i) => i !== index)
                  )
                }
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {(["user", "assistant", "system"] as PromptRole[]).map((role) => (
              <Button
                key={role}
                variant="outline"
                size="sm"
                onClick={() =>
                  setMessages((current) => [...current, { role, content: "" }])
                }
              >
                <PlusIcon />
                {ROLE_LABELS[role]} message
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,12rem))_1fr] sm:items-end">
            <Field>
              <FieldLabel htmlFor="compare-temperature">Temperature</FieldLabel>
              <Input
                id="compare-temperature"
                type="number"
                inputMode="decimal"
                min={0}
                max={2}
                step="0.1"
                placeholder="Model default"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="compare-max-tokens">Max tokens</FieldLabel>
              <Input
                id="compare-max-tokens"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Model default"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
              />
            </Field>
            <div className="flex items-center justify-end gap-3">
              <FieldDescription className="hidden sm:block">
                <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to run
              </FieldDescription>
              <Button onClick={run} disabled={running}>
                {running ? <Spinner /> : <PlayIcon />}
                Run {models.filter(Boolean).length} model
                {models.filter(Boolean).length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {Object.keys(slots).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {models.map((model, index) => {
            const slot = slots[index]
            if (!model || !slot || slot.state === "idle") return null
            return (
              <ResultCard
                key={`${index}:${model}`}
                model={model}
                slot={slot}
                fastest={fastest}
                cheapest={cheapest}
              />
            )
          })}
        </div>
      )}
      {Object.keys(slots).length > 0 && !running && (
        <p className="text-sm text-muted-foreground">
          Each run is in{" "}
          <Link href="/logs" className="underline underline-offset-4">
            Logs
          </Link>{" "}
          as a playground request.
        </p>
      )}
    </div>
  )
}

function ResultCard({
  model,
  slot,
  fastest,
  cheapest,
}: {
  model: string
  slot: Exclude<Slot, { state: "idle" }>
  fastest: number | null
  cheapest: number | null
}) {
  const result = slot.state === "done" ? slot.result : null
  return (
    <Card className="min-w-0 gap-3">
      <CardHeader>
        <CardTitle className="truncate font-mono text-sm">{model}</CardTitle>
        <CardDescription className="flex min-w-0 items-center gap-1.5 font-mono text-xs">
          {slot.state === "running" ? (
            <>
              <Spinner className="size-3" /> Running…
            </>
          ) : result?.modelSlug && result.modelSlug !== model ? (
            <>
              <ArrowRightIcon className="size-3 shrink-0" />
              <span className="truncate">{result.modelSlug}</span>
            </>
          ) : (
            (result?.provider ?? "")
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {result && (
          <div className="flex flex-wrap gap-1.5">
            {result.ok && (
              <>
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {formatMs(result.latencyMs)}
                </Badge>
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {formatNumber(result.inputTokens ?? 0)} in ·{" "}
                  {formatNumber(result.outputTokens ?? 0)} out
                </Badge>
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {result.costUsd == null
                    ? "Price unknown"
                    : formatUsd(result.costUsd)}
                </Badge>
                {fastest != null && result.latencyMs === fastest && (
                  <Badge className="font-normal">Fastest</Badge>
                )}
                {cheapest != null && result.costUsd === cheapest && (
                  <Badge className="font-normal">Cheapest</Badge>
                )}
              </>
            )}
            {result.attempts.length > 1 && (
              <Badge variant="outline" className="font-normal">
                {result.attempts.length} attempts
              </Badge>
            )}
          </div>
        )}
        {result && !result.ok ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Failed</AlertTitle>
            <AlertDescription className="break-words">
              {result.error}
            </AlertDescription>
          </Alert>
        ) : result ? (
          <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {result.content || (
              <span className="text-muted-foreground">(empty answer)</span>
            )}
          </div>
        ) : (
          <div className="h-24 animate-pulse rounded-md bg-muted/50" />
        )}
      </CardContent>
    </Card>
  )
}
