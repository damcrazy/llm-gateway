"use client"

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react"
import {
  AlertCircleIcon,
  BrainIcon,
  ChevronDownIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SendIcon,
  ShuffleIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { AttemptLogEntry } from "@/lib/db/types"
import { formatMs, formatNumber, formatUsd } from "@/lib/format"
import type {
  PlaygroundMessage,
  PlaygroundOptions,
  PlaygroundResult,
} from "@/lib/gateway/playground"
import { cn } from "@/lib/utils"

import { getPlaygroundOptions, sendPlaygroundMessage } from "./actions"

export interface AppOption {
  id: string
  name: string
  /** Owner's email when it isn't the viewer's own app. */
  owner: string | null
  enabled: boolean
}

const NO_APP = "__none"

function optionNames(options: PlaygroundOptions): string[] {
  return [
    ...options.routes.map((route) => route.name),
    ...options.modelGroups.flatMap((group) =>
      group.models.map((model) => model.slug)
    ),
  ]
}

type Entry =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; result: PlaygroundResult }
  | {
      id: string
      role: "error"
      model: string
      error: string
      result?: PlaygroundResult
    }

interface Settings {
  temperature?: number
  maxTokens?: number
}

/**
 * Chat history as the model should see it. A user turn that ended in an
 * error never reached a model, so it's left out of later requests.
 */
function toMessages(entries: Entry[], system: string): PlaygroundMessage[] {
  const messages: PlaygroundMessage[] = []
  if (system.trim()) messages.push({ role: "system", content: system.trim() })
  entries.forEach((entry, index) => {
    if (entry.role === "assistant") {
      messages.push({ role: "assistant", content: entry.content })
    } else if (entry.role === "user" && entries[index + 1]?.role !== "error") {
      messages.push({ role: "user", content: entry.content })
    }
  })
  return messages
}

function isFailedAttempt(attempt: AttemptLogEntry) {
  return (
    Boolean(attempt.error) || (attempt.status != null && attempt.status >= 400)
  )
}

const subscribeNoop = () => () => {}

function useIsMac() {
  return useSyncExternalStore(
    subscribeNoop,
    () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    () => false
  )
}

export function PlaygroundClient({
  apps,
  canRunWithoutApp,
  initialAppId,
  initialOptions,
  initialModel,
}: {
  apps: AppOption[]
  canRunWithoutApp: boolean
  initialAppId: string | null
  initialOptions: PlaygroundOptions
  initialModel: string
}) {
  const [appId, setAppId] = useState<string | null>(initialAppId)
  const [options, setOptions] = useState(initialOptions)
  const [loadingOptions, startLoadingOptions] = useTransition()
  const [model, setModel] = useState(initialModel)
  const { routes, modelGroups } = options
  const selectedApp = apps.find((app) => app.id === appId)
  const [system, setSystem] = useState("")
  const [temperature, setTemperature] = useState("")
  const [maxTokens, setMaxTokens] = useState("")
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState("")
  const [pending, startTransition] = useTransition()
  const nextId = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)
  const isMac = useIsMac()

  const selectedRoute = routes.find((route) => route.name === model)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [entries.length, pending])

  function changeApp(value: string) {
    const next = value === NO_APP ? null : value
    setAppId(next)
    startLoadingOptions(async () => {
      const result = await getPlaygroundOptions(next)
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Couldn't load models" : result.error)
        return
      }
      const names = optionNames(result.data)
      setOptions(result.data)
      setModel((current) =>
        names.includes(current) ? current : (names[0] ?? "")
      )
    })
  }

  function newId() {
    nextId.current += 1
    return `entry-${nextId.current}`
  }

  function readSettings(): Settings | null {
    const settings: Settings = {}
    if (temperature.trim() !== "") {
      const value = Number(temperature)
      if (!Number.isFinite(value) || value < 0 || value > 2) {
        toast.error("Temperature must be between 0 and 2")
        return null
      }
      settings.temperature = value
    }
    if (maxTokens.trim() !== "") {
      const value = Number(maxTokens)
      if (!Number.isInteger(value) || value < 1) {
        toast.error("Max tokens must be a whole number of at least 1")
        return null
      }
      settings.maxTokens = value
    }
    return settings
  }

  function run(history: Entry[], settings: Settings) {
    const requestedModel = model
    const messages = toMessages(history, system)
    startTransition(async () => {
      let entry: Entry
      try {
        const response = await sendPlaygroundMessage({
          model: requestedModel,
          messages,
          appId,
          ...settings,
        })
        if (!response.ok) {
          entry = {
            id: newId(),
            role: "error",
            model: requestedModel,
            error: response.error,
          }
        } else if (!response.data) {
          entry = {
            id: newId(),
            role: "error",
            model: requestedModel,
            error: "Empty response",
          }
        } else if (!response.data.ok) {
          entry = {
            id: newId(),
            role: "error",
            model: requestedModel,
            error: response.data.error ?? "Request failed",
            result: response.data,
          }
        } else {
          entry = {
            id: newId(),
            role: "assistant",
            content: response.data.content ?? "",
            result: response.data,
          }
        }
      } catch (error) {
        entry = {
          id: newId(),
          role: "error",
          model: requestedModel,
          error: error instanceof Error ? error.message : "Request failed",
        }
      }
      setEntries((current) => [...current, entry])
    })
  }

  function send() {
    const text = input.trim()
    if (!text || pending) return
    if (!model) {
      toast.error("Pick a route or model first")
      return
    }
    const settings = readSettings()
    if (!settings) return
    const history: Entry[] = [
      ...entries,
      { id: newId(), role: "user", content: text },
    ]
    setEntries(history)
    setInput("")
    run(history, settings)
  }

  function retry() {
    if (pending || entries.at(-1)?.role !== "error") return
    const settings = readSettings()
    if (!settings) return
    const history = entries.slice(0, -1)
    setEntries(history)
    run(history, settings)
  }

  function clear() {
    setEntries([])
    setInput("")
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>
            Sent exactly like an app would send it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="playground-app">Run as</FieldLabel>
              <Select
                value={appId ?? NO_APP}
                onValueChange={changeApp}
                disabled={pending}
              >
                <SelectTrigger id="playground-app" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-80">
                  {canRunWithoutApp && (
                    <SelectItem value={NO_APP}>
                      No app (unrestricted)
                    </SelectItem>
                  )}
                  {apps.map((app) => (
                    <SelectItem key={app.id} value={app.id}>
                      {app.name}
                      {app.owner && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {app.owner}
                        </span>
                      )}
                      {!app.enabled && (
                        <span className="text-muted-foreground">
                          {" "}
                          (disabled)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {selectedApp
                  ? "Exactly like a call with this app's key: its allowed models, rate limit and budget apply (and its owner's), and usage is logged under it."
                  : "Unrestricted test as you; usage is logged without an app."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="playground-model">
                Route or model
                {loadingOptions && <Spinner className="size-3" />}
              </FieldLabel>
              {routes.length === 0 && modelGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {selectedApp
                    ? "This app can't call any enabled chat route or model."
                    : "Enable a chat model or create a chat route first."}
                </p>
              ) : (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger
                    id="playground-model"
                    className="w-full min-w-0 font-mono"
                  >
                    <SelectValue placeholder="Pick a route or model" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-80">
                    {routes.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Routes</SelectLabel>
                        {routes.map((route) => (
                          <SelectItem
                            key={route.name}
                            value={route.name}
                            className="font-mono"
                          >
                            {route.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {modelGroups.map((group, index) => (
                      <SelectGroup key={group.provider}>
                        {(index > 0 || routes.length > 0) && (
                          <SelectSeparator />
                        )}
                        <SelectLabel>{group.provider}</SelectLabel>
                        {group.models.map((option) => (
                          <SelectItem
                            key={option.slug}
                            value={option.slug}
                            className="font-mono"
                          >
                            {option.slug}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FieldDescription>
                {selectedRoute
                  ? `${selectedRoute.description ? `${selectedRoute.description}. ` : ""}Route with ${
                      selectedRoute.strategy === "round_robin"
                        ? "round-robin"
                        : "fallback"
                    } across its models.`
                  : "Direct model call: no fallback to other models."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="playground-system">System prompt</FieldLabel>
              <Textarea
                id="playground-system"
                placeholder="You are a helpful assistant."
                className="max-h-64"
                value={system}
                onChange={(event) => setSystem(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="playground-temperature">
                  Temperature
                </FieldLabel>
                <Input
                  id="playground-temperature"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={2}
                  step={0.1}
                  placeholder="Default"
                  value={temperature}
                  onChange={(event) => setTemperature(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="playground-max-tokens">
                  Max tokens
                </FieldLabel>
                <Input
                  id="playground-max-tokens"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  placeholder="Default"
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 py-0">
        <CardHeader className="border-b py-4 [.border-b]:pb-4">
          <CardTitle>Conversation</CardTitle>
          <CardDescription>
            {entries.length
              ? `${entries.length} message${entries.length === 1 ? "" : "s"}; the full history is sent each turn.`
              : "The full history is sent each turn."}
          </CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || entries.length === 0}
              onClick={clear}
            >
              <Trash2Icon />
              Clear
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          <ScrollArea className="h-[55vh] min-h-80">
            <div className="flex flex-col gap-5 p-4 md:p-6">
              {entries.length === 0 && !pending ? (
                <Empty className="p-6">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareIcon />
                    </EmptyMedia>
                    <EmptyTitle>Say hello</EmptyTitle>
                    <EmptyDescription>
                      Replies show which model served them, latency, tokens and
                      cost. If a target fails, you&apos;ll see the gateway fall
                      back to the next one.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                entries.map((entry, index) => {
                  if (entry.role === "user") {
                    return (
                      <UserMessage key={entry.id} content={entry.content} />
                    )
                  }
                  if (entry.role === "assistant") {
                    return (
                      <AssistantMessage
                        key={entry.id}
                        content={entry.content}
                        result={entry.result}
                      />
                    )
                  }
                  return (
                    <ErrorMessage
                      key={entry.id}
                      entry={entry}
                      onRetry={
                        index === entries.length - 1 && !pending
                          ? retry
                          : undefined
                      }
                    />
                  )
                })
              )}
              {pending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  Waiting for <span className="font-mono">{model}</span>…
                </div>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter className="border-t p-4 [.border-t]:pt-4">
          <form
            className="grid w-full gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <Textarea
              aria-label="Message"
              placeholder="Type a message…"
              className="max-h-48 min-h-20"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <KbdGroup className="hidden text-muted-foreground sm:inline-flex">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>Enter</Kbd>
                <span className="text-xs">to send</span>
              </KbdGroup>
              <Button
                type="submit"
                className="ml-auto"
                disabled={pending || !input.trim()}
              >
                {pending ? <Spinner /> : <SendIcon />}
                Send
              </Button>
            </div>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
        {content}
      </div>
    </div>
  )
}

function AssistantMessage({
  content,
  result,
}: {
  content: string
  result: PlaygroundResult
}) {
  const failed = result.attempts.filter(isFailedAttempt)

  return (
    <div className="flex max-w-[85%] flex-col items-start gap-1.5">
      {result.reasoning && (
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground [&[data-state=open]>svg:last-child]:rotate-180"
            >
              <BrainIcon />
              Reasoning
              <ChevronDownIcon className="transition-transform" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 border-l-2 pl-3 text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {result.reasoning}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className="rounded-lg bg-muted px-3 py-2 text-sm break-words whitespace-pre-wrap">
        {content || (
          <span className="text-muted-foreground italic">Empty response</span>
        )}
      </div>
      <ResultMeta result={result} />
      {result.attempts.length > 1 && failed.length > 0 && (
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 [&[data-state=open]>svg:last-child]:rotate-180"
            >
              <ShuffleIcon />
              Fell back after {failed.length} failed attempt
              {failed.length === 1 ? "" : "s"}
              <ChevronDownIcon className="transition-transform" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <AttemptList attempts={failed} className="mt-1" />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function ResultMeta({ result }: { result: PlaygroundResult }) {
  const parts: React.ReactNode[] = []
  if (result.modelSlug) {
    parts.push(
      <>
        served by{" "}
        <span className="font-mono text-foreground">{result.modelSlug}</span>
        {result.provider && ` · ${result.provider}`}
      </>
    )
  }
  parts.push(formatMs(result.latencyMs))
  if (result.inputTokens != null || result.outputTokens != null) {
    parts.push(
      `${formatNumber(result.inputTokens)} in / ${formatNumber(result.outputTokens)} out`
    )
  }
  parts.push(
    result.costUsd != null ? formatUsd(result.costUsd) : "cost unknown"
  )

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-xs text-muted-foreground">
      {parts.map((part, index) => (
        <span key={index} className="inline-flex items-center gap-2">
          {index > 0 && <span aria-hidden>·</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}

function AttemptList({
  attempts,
  className,
}: {
  attempts: AttemptLogEntry[]
  className?: string
}) {
  return (
    <ol
      className={cn(
        "grid gap-2 rounded-md border bg-background p-3 text-xs",
        className
      )}
    >
      {attempts.map((attempt, index) => (
        <li key={`${attempt.model_id}-${index}`} className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground tabular-nums">
              {index + 1}.
            </span>
            <span className="font-mono break-all text-foreground">
              {attempt.model}
            </span>
            <span className="text-muted-foreground">
              via {attempt.provider}
            </span>
            <Badge variant="destructive">
              {attempt.status ?? "no response"}
            </Badge>
            <span className="text-muted-foreground">
              {formatMs(attempt.latency_ms)}
            </span>
            {attempt.cooldown_s ? (
              <span className="text-muted-foreground">
                cooling down {attempt.cooldown_s}s
              </span>
            ) : null}
          </div>
          {attempt.error && (
            <p className="break-words whitespace-pre-wrap text-muted-foreground">
              {attempt.error}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

function ErrorMessage({
  entry,
  onRetry,
}: {
  entry: Extract<Entry, { role: "error" }>
  onRetry?: () => void
}) {
  const attempts = entry.result?.attempts ?? []
  const latency = entry.result?.latencyMs

  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>
        <span className="font-mono">{entry.model}</span> failed
        {latency ? ` after ${formatMs(latency)}` : ""}
      </AlertTitle>
      <AlertDescription className="grid gap-3">
        <p className="break-words whitespace-pre-wrap">{entry.error}</p>
        {attempts.length > 0 && (
          <div className="grid gap-1.5">
            <span className="font-medium">
              {attempts.length} attempt{attempts.length === 1 ? "" : "s"}
            </span>
            <AttemptList attempts={attempts} />
          </div>
        )}
        {onRetry && (
          <div>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcwIcon />
              Retry
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
