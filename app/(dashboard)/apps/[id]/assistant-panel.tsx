"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  RotateCcwIcon,
  SendHorizontalIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet"
import { ModelPrice } from "@/components/model-price"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import type { ActionResult } from "@/lib/actions"
import {
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  type AssistantProposal,
  type AssistantTurnInput,
  type AssistantTurnResult,
} from "@/lib/bucket-assistant/contract"
import type { AssistantOp, BucketsState } from "@/lib/bucket-assistant/ops"
import {
  isAllowedRunsOn,
  type AssistantOptions,
} from "@/lib/bucket-assistant/options"
import { cn } from "@/lib/utils"

export interface ApplyOutcome {
  applied: number
  skipped: { line: string; error: string }[]
}

type Entry =
  | { id: number; role: "user"; content: string }
  | {
      id: number
      role: "assistant"
      content: string
      steps: string[]
      question?: { text: string; options: string[] }
    }
  | { id: number; role: "error"; content: string }

type ProposalCard = {
  proposal: AssistantProposal
  status: "open" | "applied" | "discarded"
  skipped: ApplyOutcome["skipped"]
}

const STARTERS = [
  "Make an embeddings bucket",
  "Free chat bucket with fallbacks",
  "Cheapest coding bucket",
  "Review my buckets",
]

const storageKey = (appId: string) => `bucket-assistant:runs-on:${appId}`

function readRunsOn(appId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(appId))
  } catch {
    return null
  }
}

function writeRunsOn(appId: string, value: string) {
  try {
    window.localStorage.setItem(storageKey(appId), value)
  } catch {
    // Private windows and blocked storage: just don't remember it.
  }
}

function firstOption(options: AssistantOptions): string | null {
  return (
    options.buckets[0]?.name ?? options.modelGroups[0]?.models[0]?.slug ?? null
  )
}

/** The plain-text history the server gets: no tool calls, no errors. */
function history(entries: Entry[]): AssistantTurnInput["messages"] {
  return entries
    .flatMap((entry): AssistantTurnInput["messages"] => {
      if (entry.role === "user")
        return [{ role: "user", content: entry.content }]
      if (entry.role === "assistant") {
        const content = [entry.content, entry.question?.text]
          .filter(Boolean)
          .join("\n\n")
        return content ? [{ role: "assistant", content }] : []
      }
      return []
    })
    .map((m) => ({ ...m, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY)
}

/**
 * A chat that proposes bucket changes. It runs on the app's own models; the
 * board only changes when the user clicks Apply.
 */
export function AssistantPanel({
  open,
  onOpenChange,
  appId,
  getBoardState,
  onApply,
  ask,
  loadOptions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  getBoardState: () => BucketsState
  onApply: (ops: AssistantOp[]) => ApplyOutcome
  ask: (input: AssistantTurnInput) => Promise<ActionResult<AssistantTurnResult>>
  loadOptions: () => Promise<ActionResult<AssistantOptions>>
}) {
  const [options, setOptions] = useState<AssistantOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [runsOn, setRunsOn] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [card, setCard] = useState<ProposalCard | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const nextId = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || options) return
    let cancelled = false
    void loadOptions().then((result) => {
      if (cancelled) return
      if (!result.ok || !result.data) {
        setOptionsError(result.ok ? "Couldn't load your models" : result.error)
        return
      }
      const loaded = result.data
      setOptions(loaded)
      setOptionsError(null)
      // A remembered choice that's no longer offered falls back to the first.
      const remembered = readRunsOn(appId)
      setRunsOn(
        remembered && isAllowedRunsOn(loaded, remembered)
          ? remembered
          : firstOption(loaded)
      )
    })
    return () => {
      cancelled = true
    }
  }, [open, options, loadOptions, appId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [entries, card, busy])

  const pendingOps = useMemo(
    () => (card?.status === "open" ? card.proposal.ops : []),
    [card]
  )

  const runTurn = useCallback(
    async (messages: AssistantTurnInput["messages"]) => {
      if (!runsOn) return
      setBusy(true)
      const result = await ask({
        runsOn,
        messages,
        board: getBoardState(),
        pendingOps,
      })
      setBusy(false)
      if (!result.ok || !result.data) {
        const error = result.ok ? "No answer came back" : result.error
        setEntries((current) => [
          ...current,
          { id: nextId.current++, role: "error", content: error },
        ])
        return
      }
      const turn = result.data
      setEntries((current) => [
        ...current,
        {
          id: nextId.current++,
          role: "assistant",
          content: turn.reply,
          steps: turn.steps,
          ...(turn.question ? { question: turn.question } : {}),
        },
      ])
      if (turn.proposal.ops.length)
        setCard({ proposal: turn.proposal, status: "open", skipped: [] })
      // Everything pending was dropped (it no longer fits the board).
      else if (pendingOps.length) setCard(null)
    },
    [ask, getBoardState, pendingOps, runsOn]
  )

  const send = useCallback(
    (text: string) => {
      const content = text.trim()
      if (!content || busy || !runsOn) return
      const user: Entry = { id: nextId.current++, role: "user", content }
      const next = [...entries, user]
      setEntries(next)
      setDraft("")
      void runTurn(history(next))
    },
    [busy, entries, runTurn, runsOn]
  )

  const retry = useCallback(() => {
    if (busy) return
    const kept = entries.filter((entry) => entry.role !== "error")
    setEntries(kept)
    void runTurn(history(kept))
  }, [busy, entries, runTurn])

  const reset = () => {
    setEntries([])
    setCard(null)
    setDraft("")
  }

  const apply = () => {
    if (!card) return
    const outcome = onApply(card.proposal.ops)
    setCard({ ...card, status: "applied", skipped: outcome.skipped })
  }

  const last = entries.at(-1)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:w-[420px]"
        data-tour="app-assistant-panel"
      >
        <SheetHeader className="gap-3 border-b">
          <div className="flex items-center gap-2 pr-6">
            <SparklesIcon className="size-4 text-primary" />
            <SheetTitle>Bucket assistant</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={reset}
              disabled={busy || (!entries.length && !card)}
            >
              <RotateCcwIcon />
              New chat
            </Button>
          </div>
          <SheetDescription className="sr-only">
            Describe the bucket you want; the assistant proposes changes you can
            apply.
          </SheetDescription>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Runs on
            </span>
            {optionsError ? (
              <p className="text-xs text-destructive">{optionsError}</p>
            ) : (
              <Select
                value={runsOn ?? undefined}
                onValueChange={(value) => {
                  setRunsOn(value)
                  writeRunsOn(appId, value)
                }}
                disabled={!options || busy}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-label="Runs on"
                >
                  <SelectValue
                    placeholder={options ? "No models available" : "Loading…"}
                  />
                </SelectTrigger>
                <SelectContent position="popper">
                  {options?.buckets.length ? (
                    <SelectGroup>
                      <SelectLabel>This app&apos;s buckets</SelectLabel>
                      {options.buckets.map((bucket) => (
                        <SelectItem key={bucket.name} value={bucket.name}>
                          <span className="font-mono">{bucket.name}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {options?.modelGroups.map((group) => (
                    <SelectGroup key={group.provider}>
                      <SelectLabel>{group.provider}</SelectLabel>
                      {group.models.map((model) => (
                        <SelectItem key={model.slug} value={model.slug}>
                          <span className="truncate">{model.name}</span>
                          <span className="text-xs">
                            <ModelPrice
                              input={model.inputPrice}
                              output={model.outputPrice}
                            />
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
            {options && !options.toolsKnown && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                None of your models are marked for tool calling. The assistant
                may not work.
              </p>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-3 p-4">
            {entries.length === 0 && !busy && (
              <div className="grid gap-3 py-2">
                <p className="text-sm text-muted-foreground">
                  Tell me what the bucket is for. I&apos;ll look at your models,
                  ask how you want it, and propose changes you can apply.
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((starter) => (
                    <Button
                      key={starter}
                      variant="outline"
                      size="sm"
                      disabled={!runsOn}
                      onClick={() => send(starter)}
                    >
                      {starter}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {entries.map((entry) => {
              if (entry.role === "user")
                return (
                  <div
                    key={entry.id}
                    className="ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap"
                  >
                    {entry.content}
                  </div>
                )
              if (entry.role === "error")
                return (
                  <Alert key={entry.id} variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>The assistant couldn&apos;t answer</AlertTitle>
                    <AlertDescription className="grid gap-2">
                      <span>{entry.content}</span>
                      {entry === last && (
                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={retry}
                            disabled={busy}
                          >
                            <RotateCcwIcon />
                            Retry
                          </Button>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )
              const answerable = entry === last && !busy
              return (
                <div key={entry.id} className="grid gap-1.5">
                  {entry.steps.map((step, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      · {step}
                    </p>
                  ))}
                  {entry.content && (
                    <p className="text-sm whitespace-pre-wrap">
                      {entry.content}
                    </p>
                  )}
                  {entry.question && (
                    <div className="grid gap-2">
                      <p className="text-sm font-medium whitespace-pre-wrap">
                        {entry.question.text}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {entry.question.options.map((option) => (
                          <Button
                            key={option}
                            variant="outline"
                            size="sm"
                            disabled={!answerable}
                            onClick={() => send(option)}
                          >
                            {option}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3.5" />
                Thinking…
              </p>
            )}

            {card && (
              <ProposalCardView
                card={card}
                busy={busy}
                onApply={apply}
                onDiscard={() => setCard({ ...card, status: "discarded" })}
              />
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        <form
          className="grid gap-1.5 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  send(draft)
                }
              }}
              maxLength={MAX_MESSAGE_CHARS}
              placeholder="Ask about your buckets…"
              aria-label="Message the bucket assistant"
              className="max-h-40 min-h-10 resize-none"
              rows={1}
              disabled={busy || !runsOn}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={busy || !runsOn || !draft.trim()}
            >
              <SendHorizontalIcon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Runs on your models; billed to this app.
          </p>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function ProposalCardView({
  card,
  busy,
  onApply,
  onDiscard,
}: {
  card: ProposalCard
  busy: boolean
  onApply: () => void
  onDiscard: () => void
}) {
  const { proposal, status, skipped } = card
  const warned = proposal.warnings.length > 0
  return (
    <div
      className={cn(
        "grid gap-3 rounded-lg border bg-card p-3",
        status === "open" && warned && "border-destructive/60",
        status !== "open" && "opacity-80"
      )}
      data-tour="app-assistant-proposal"
    >
      <p className="text-sm font-semibold">Proposed changes</p>
      <ol className="grid list-decimal gap-1 pl-5 text-sm">
        {proposal.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
      {status === "open" &&
        proposal.warnings.map((warning) => (
          <Alert
            key={warning.bucket}
            variant="destructive"
            className="border-destructive/50 bg-destructive/10"
          >
            <TriangleAlertIcon />
            <AlertTitle>{warning.title}</AlertTitle>
            <AlertDescription>{warning.body}</AlertDescription>
          </Alert>
        ))}
      {status === "open" ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
          <Button
            variant={warned ? "destructive" : "default"}
            size="sm"
            onClick={onApply}
            disabled={busy}
          >
            {warned ? "Apply anyway" : "Apply"}
          </Button>
        </div>
      ) : status === "applied" ? (
        <div className="grid gap-1 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Applied
          </p>
          {skipped.map((item, i) => (
            <p key={i} className="text-xs text-destructive">
              Skipped: {item.line} ({item.error})
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Discarded</p>
      )}
    </div>
  )
}
