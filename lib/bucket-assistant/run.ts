// One turn of the bucket assistant: call the model with the tools, run the
// tool calls it makes, repeat until it answers, asks a question, or hits a
// limit. The model call is injected so this runs without a gateway in tests.

import type { BucketsData } from "@/app/(dashboard)/apps/[id]/buckets-shared"
import type { ChatMessage, ChatTool } from "@/lib/gateway/types"

import type { AssistantTurnInput, AssistantTurnResult } from "./contract"
import { applyOps, describeOp, proposalWarnings } from "./ops"
import { buildSystemPrompt } from "./prompt"
import { createWorkspace, runTool, TOOLS } from "./tools"

export const MAX_MODEL_CALLS = 8
export const MAX_TOOL_FAILURES = 3

export type CallModel = (request: {
  messages: ChatMessage[]
  tools: ChatTool[]
}) => Promise<{
  message: ChatMessage
  inputTokens: number
  outputTokens: number
  costUsd?: number
}>

const CAP_NOTE = `I stopped after ${MAX_MODEL_CALLS} steps. Ask me to continue if the proposal isn't finished.`
const FAILURE_NOTE =
  "I kept getting the tools wrong, so I stopped. Try again, or pick another model in Runs on."
const EMPTY_NOTE =
  "I couldn't come up with an answer. Try rephrasing, or pick another model in Runs on."
const PROPOSAL_NOTE = "Here's what I'd change."

function textOf(message: ChatMessage): string {
  const { content } = message
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content))
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String(part.text ?? "")
          : ""
      )
      .join("")
      .trim()
  return ""
}

export async function runAssistantTurn({
  data,
  appName,
  input,
  callModel,
}: {
  data: BucketsData
  appName: string
  input: AssistantTurnInput
  callModel: CallModel
}): Promise<AssistantTurnResult> {
  const ws = createWorkspace(data, input.board)
  const nameOf = (id: string) => ws.ctx.models.get(id)?.name ?? id

  // Start from the proposal the user hasn't applied yet.
  const replay = applyOps(ws.state, input.pendingOps, ws.ctx)
  ws.state = replay.state
  ws.ops = [...replay.applied]
  const notes = replay.skipped.map(
    ({ op, error }) =>
      `An earlier proposed change no longer applies and was dropped: ${describeOp(op, nameOf)} (${error})`
  )

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        appName,
        state: input.board,
        ownerAccess: data.ownerAccess,
        notes,
      }),
    },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const steps: string[] = []
  const usage: AssistantTurnResult["usage"] = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }
  let costKnown = true
  let reply = ""
  let lastText = ""
  let question: AssistantTurnResult["question"]
  let failures = 0
  let stopNote = ""

  while (true) {
    if (usage.calls >= MAX_MODEL_CALLS) {
      stopNote = CAP_NOTE
      break
    }
    const answer = await callModel({ messages, tools: TOOLS })
    usage.calls++
    usage.inputTokens += answer.inputTokens
    usage.outputTokens += answer.outputTokens
    if (answer.costUsd === undefined) costKnown = false
    else usage.costUsd = (usage.costUsd ?? 0) + answer.costUsd

    const text = textOf(answer.message)
    if (text) lastText = text
    const calls = answer.message.tool_calls ?? []
    if (!calls.length) {
      reply = text
      break
    }

    messages.push({
      role: "assistant",
      content: answer.message.content ?? null,
      tool_calls: calls,
    })
    for (const [index, toolCall] of calls.entries()) {
      const id = toolCall.id || `call_${usage.calls}_${index}`
      const outcome = runTool(
        ws,
        toolCall.function?.name ?? "",
        toolCall.function?.arguments ?? ""
      )
      messages.push({
        role: "tool",
        tool_call_id: id,
        content: outcome.content,
      })
      steps.push(outcome.step)
      if (outcome.question) question = outcome.question
      failures = outcome.ok ? 0 : failures + 1
      if (failures >= MAX_TOOL_FAILURES) break
    }
    if (failures >= MAX_TOOL_FAILURES) {
      stopNote = FAILURE_NOTE
      break
    }
    if (question) {
      reply = text
      break
    }
  }

  if (stopNote === FAILURE_NOTE) reply = FAILURE_NOTE
  else if (stopNote) reply = [lastText, stopNote].filter(Boolean).join("\n\n")
  // An earlier "Let me check the models" isn't an answer to show.
  if (!reply && !question)
    reply = ws.ops.length ? PROPOSAL_NOTE : lastText || EMPTY_NOTE

  if (!costKnown) delete usage.costUsd
  return {
    reply,
    ...(question ? { question } : {}),
    steps,
    proposal: {
      ops: ws.ops,
      lines: ws.ops.map((op) => describeOp(op, nameOf)),
      warnings: proposalWarnings(ws.state, ws.ops, ws.ctx),
    },
    usage,
  }
}
