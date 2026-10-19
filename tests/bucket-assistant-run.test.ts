import { describe, expect, test } from "bun:test"

import type { AssistantTurnInput } from "@/lib/bucket-assistant/contract"
import { assistantErrorMessage } from "@/lib/bucket-assistant/errors"
import {
  MAX_MODEL_CALLS,
  runAssistantTurn,
  type CallModel,
} from "@/lib/bucket-assistant/run"
import { ClientAbortError, GatewayError } from "@/lib/gateway/errors"
import type { ChatMessage, ChatTool } from "@/lib/gateway/types"

import { bucketModel, bucketsData } from "./bucket-fixtures"

const chat = bucketModel({ id: "chat", name: "Chat One" })
const embed = bucketModel({ id: "embed", name: "Embed One", kind: "embedding" })
const data = bucketsData([chat, embed])

let callId = 0
const call = (name: string, args: object | string): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: `call-${++callId}`,
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    },
  ],
})
const say = (content: string): ChatMessage => ({ role: "assistant", content })

/** A fake model: answers with `script` in order (the last one repeats). */
function scripted(...script: ChatMessage[]) {
  const requests: { messages: ChatMessage[]; tools: ChatTool[] }[] = []
  const callModel: CallModel = async (request) => {
    requests.push(structuredClone(request))
    const message = script[Math.min(requests.length - 1, script.length - 1)]!
    return { message, inputTokens: 10, outputTokens: 5, costUsd: 0.001 }
  }
  return { callModel, requests }
}

const input = (
  extra: Partial<AssistantTurnInput> = {}
): AssistantTurnInput => ({
  runsOn: "prov/chat",
  messages: [{ role: "user", content: "make me an embeddings bucket" }],
  board: { buckets: [], defaultBucket: null, onlyBucketModels: false },
  pendingOps: [],
  ...extra,
})

const turn = (callModel: CallModel, extra: Partial<AssistantTurnInput> = {}) =>
  runAssistantTurn({ data, appName: "Demo", input: input(extra), callModel })

test("a plain reply", async () => {
  const { callModel, requests } = scripted(say("Hi"))
  const result = await turn(callModel)
  expect(result.reply).toBe("Hi")
  expect(result.proposal.ops).toEqual([])
  expect(result.usage).toEqual({
    calls: 1,
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
  })
  expect(requests[0]!.messages[0]!.role).toBe("system")
  expect(requests[0]!.messages.at(-1)).toEqual({
    role: "user",
    content: "make me an embeddings bucket",
  })
  expect(requests[0]!.tools.length).toBe(8)
})

test("a tool call, then a reply", async () => {
  const create = call("create_bucket", {
    name: "embed",
    models: ["prov/embed"],
  })
  const { callModel, requests } = scripted(create, say("Done: embed."))
  const result = await turn(callModel)
  expect(result.reply).toBe("Done: embed.")
  expect(result.proposal.ops).toHaveLength(1)
  expect(result.proposal.lines).toEqual(['Create bucket "embed": 1. Embed One'])
  expect(result.steps).toContain('Create bucket "embed": 1. Embed One')
  const toolMessage = requests[1]!.messages.at(-1)!
  expect(toolMessage.role).toBe("tool")
  expect(toolMessage.tool_call_id).toBe(create.tool_calls![0]!.id)
  expect(result.usage.calls).toBe(2)
})

test("ask_user ends the turn", async () => {
  const { callModel, requests } = scripted(
    call("ask_user", { question: "Free only?", options: ["Yes", "No"] })
  )
  const result = await turn(callModel)
  expect(result.question).toEqual({
    text: "Free only?",
    options: ["Yes", "No"],
  })
  expect(requests).toHaveLength(1)
})

test("a change and a question in one message: both count", async () => {
  const both: ChatMessage = {
    role: "assistant",
    content: "Here's a start.",
    tool_calls: [
      ...call("create_bucket", { name: "embed", models: ["prov/embed"] })
        .tool_calls!,
      ...call("ask_user", {
        question: "Add a fallback?",
        options: ["Yes", "No"],
      }).tool_calls!,
    ],
  }
  const { callModel, requests } = scripted(both)
  const result = await turn(callModel)
  expect(result.question?.text).toBe("Add a fallback?")
  expect(result.proposal.ops).toHaveLength(1)
  expect(result.reply).toBe("Here's a start.")
  expect(requests).toHaveLength(1)
})

test(`stops after ${MAX_MODEL_CALLS} model calls`, async () => {
  const { callModel, requests } = scripted(call("list_buckets", {}))
  const result = await turn(callModel)
  expect(requests).toHaveLength(8)
  expect(result.reply).toEndWith(
    "I stopped after 8 steps. Ask me to continue if the proposal isn't finished."
  )
})

test("stops after 3 failed tool calls in a row", async () => {
  const { callModel, requests } = scripted(call("no_such_tool", {}))
  const result = await turn(callModel)
  expect(requests).toHaveLength(3)
  expect(result.reply).toBe(
    "I kept getting the tools wrong, so I stopped. Try again, or pick another model in Runs on."
  )
})

describe("pending proposal", () => {
  test("is replayed onto the draft and kept first", async () => {
    const { callModel, requests } = scripted(
      call("list_buckets", {}),
      say("ok")
    )
    const result = await turn(callModel, {
      pendingOps: [
        { type: "create_bucket", name: "embed", modelIds: ["embed"] },
      ],
    })
    const listed = JSON.parse(String(requests[1]!.messages.at(-1)!.content))
    expect(listed.buckets.map((b: { name: string }) => b.name)).toEqual([
      "embed",
    ])
    expect(result.proposal.ops[0]).toMatchObject({
      type: "create_bucket",
      name: "embed",
    })
  })

  test("drops a change that no longer applies, and tells the model", async () => {
    const { callModel, requests } = scripted(say("ok"))
    const result = await turn(callModel, {
      pendingOps: [{ type: "add_models", bucket: "gone", modelIds: ["chat"] }],
    })
    expect(result.proposal.ops).toEqual([])
    expect(String(requests[0]!.messages[0]!.content)).toContain(
      "no longer applies"
    )
  })
})

test("an empty answer gets a fallback reply", async () => {
  const { callModel } = scripted(say(""))
  expect((await turn(callModel)).reply).toBe(
    "I couldn't come up with an answer. Try rephrasing, or pick another model in Runs on."
  )
})

test("a proposal without closing words still gets a reply", async () => {
  const { callModel } = scripted(
    call("create_bucket", { name: "embed", models: ["prov/embed"] }),
    say("")
  )
  expect((await turn(callModel)).reply).toBe("Here's what I'd change.")
})

test("an early aside isn't the reply once there's a proposal", async () => {
  const lookFirst: ChatMessage = {
    ...call("create_bucket", { name: "embed", models: ["prov/embed"] }),
    content: "Let me check the models.",
  }
  const { callModel } = scripted(lookFirst, say(""))
  expect((await turn(callModel)).reply).toBe("Here's what I'd change.")
})

test("a mixed bucket in the proposal comes with its warning", async () => {
  const { callModel } = scripted(
    call("create_bucket", { name: "x", models: ["prov/chat", "prov/embed"] }),
    say("Proposed.")
  )
  const result = await turn(callModel)
  expect(result.proposal.warnings).toHaveLength(1)
  expect(result.proposal.warnings[0]).toMatchObject({
    bucket: "x",
    title: "This bucket mixes chat and embedding models",
  })
})

test("cost is unknown when any call's cost is", async () => {
  let n = 0
  const callModel: CallModel = async () => {
    n++
    return n === 1
      ? { message: call("list_buckets", {}), inputTokens: 1, outputTokens: 1 }
      : { message: say("ok"), inputTokens: 1, outputTokens: 1, costUsd: 0.01 }
  }
  const result = await turn(callModel)
  expect(result.usage.calls).toBe(2)
  expect(result.usage.costUsd).toBeUndefined()
})

describe("assistantErrorMessage", () => {
  test("tool trouble names the model", () => {
    expect(
      assistantErrorMessage(
        new GatewayError(
          400,
          "This model does not support tools",
          "bad_request"
        ),
        "prov/tiny"
      )
    ).toBe(
      "prov/tiny couldn't use the assistant's tools. Try another model in Runs on."
    )
  })

  test("other gateway errors pass through", () => {
    expect(
      assistantErrorMessage(
        new GatewayError(429, "Rate limit reached", "rate_limited"),
        "x"
      )
    ).toBe("Rate limit reached")
  })

  test("timeouts", () => {
    const timeout = new Error("timed out")
    timeout.name = "TimeoutError"
    expect(assistantErrorMessage(new ClientAbortError(), "x")).toBe(
      "The assistant took too long. Try again."
    )
    expect(assistantErrorMessage(timeout, "x")).toBe(
      "The assistant took too long. Try again."
    )
  })

  test("anything else", () => {
    expect(assistantErrorMessage(new Error("boom"), "x")).toBe(
      "Something went wrong. Try again."
    )
  })
})

test("the model never sees a conversation that opens with the assistant", async () => {
  const { callModel, requests } = scripted(say("ok"))
  await turn(callModel, {
    messages: [
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "and now?" },
    ],
  })
  expect(requests[0]!.messages[1]).toEqual({
    role: "user",
    content: "and now?",
  })
})
