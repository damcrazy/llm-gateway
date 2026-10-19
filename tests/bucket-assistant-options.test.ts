import { describe, expect, test } from "bun:test"

import {
  assistantTurnInputSchema,
  trimHistory,
} from "@/lib/bucket-assistant/contract"
import {
  buildAssistantOptions,
  isAllowedRunsOn,
} from "@/lib/bucket-assistant/options"

import { bucketModel, bucketsData } from "./bucket-fixtures"

const input = {
  runsOn: "smart",
  messages: [
    { role: "user" as const, content: "make me an embeddings bucket" },
  ],
  board: { buckets: [], defaultBucket: null, onlyBucketModels: false },
  pendingOps: [],
}

describe("assistantTurnInputSchema", () => {
  test("accepts a valid turn", () => {
    expect(assistantTurnInputSchema.safeParse(input).success).toBe(true)
  })

  test("rejects too many or too long messages, and too many pending ops", () => {
    const message = { role: "user" as const, content: "hi" }
    expect(
      assistantTurnInputSchema.safeParse({
        ...input,
        messages: Array.from({ length: 21 }, () => message),
      }).success
    ).toBe(false)
    expect(
      assistantTurnInputSchema.safeParse({
        ...input,
        messages: [{ role: "user", content: "x".repeat(4001) }],
      }).success
    ).toBe(false)
    expect(
      assistantTurnInputSchema.safeParse({
        ...input,
        pendingOps: Array.from({ length: 51 }, () => ({
          type: "delete_bucket",
          name: "x",
        })),
      }).success
    ).toBe(false)
  })
})

const flash = bucketModel({ id: "flash", name: "Flash", provider: "Google" })
const alpha = bucketModel({ id: "alpha", name: "Alpha", provider: "Google" })
const mini = bucketModel({
  id: "mini",
  name: "Mini",
  provider: "OpenAI",
  inputPrice: 0.15,
  outputPrice: 0.6,
})
const noTools = bucketModel({ id: "plain", name: "Plain", capabilities: [] })
const embed = bucketModel({ id: "embed", name: "Embed", kind: "embedding" })
const locked = bucketModel({ id: "locked", name: "Locked" })

const data = bucketsData([flash, alpha, mini, noTools, embed, locked], {
  addable: ["flash", "alpha", "mini", "plain", "embed"],
  buckets: [
    {
      name: "smart",
      modelIds: ["mini"],
      strategy: "ordered",
      hedgeAfterMs: null,
    },
    {
      name: "vectors",
      modelIds: ["embed"],
      strategy: "ordered",
      hedgeAfterMs: null,
    },
  ],
})

describe("buildAssistantOptions", () => {
  test("buckets with a chat model, in board order", () => {
    expect(buildAssistantOptions(data).buckets).toEqual([{ name: "smart" }])
  })

  test("addable tool-capable chat models, grouped and sorted", () => {
    const options = buildAssistantOptions(data)
    expect(options.toolsKnown).toBe(true)
    expect(
      options.modelGroups.map((g) => [g.provider, g.models.map((m) => m.slug)])
    ).toEqual([
      ["Google", ["prov/alpha", "prov/flash"]],
      ["OpenAI", ["prov/mini"]],
    ])
    expect(options.modelGroups[1]!.models[0]).toEqual({
      slug: "prov/mini",
      name: "Mini",
      tier: "paid",
      inputPrice: 0.15,
      outputPrice: 0.6,
    })
  })

  test("lists every addable chat model when none is marked for tools", () => {
    const options = buildAssistantOptions(
      bucketsData([noTools, bucketModel({ id: "other", capabilities: [] })])
    )
    expect(options.toolsKnown).toBe(false)
    expect(
      options.modelGroups.flatMap((g) => g.models.map((m) => m.slug))
    ).toEqual(["prov/other", "prov/plain"])
  })
})

test("isAllowedRunsOn only accepts what's offered", () => {
  const options = buildAssistantOptions(data)
  expect(isAllowedRunsOn(options, "smart")).toBe(true)
  expect(isAllowedRunsOn(options, "prov/flash")).toBe(true)
  // A bucket deleted since the choice was remembered, a model no longer addable.
  expect(isAllowedRunsOn(options, "old-bucket")).toBe(false)
  expect(isAllowedRunsOn(options, "prov/locked")).toBe(false)
})

describe("trimHistory", () => {
  const alternating = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `m${i}`,
    }))

  test("keeps the last 20 messages, starting on a user message", () => {
    // 11 exchanges plus the new question: the window would open on "assistant".
    const trimmed = trimHistory(alternating(23))
    expect(trimmed.length).toBeLessThanOrEqual(20)
    expect(trimmed[0]!.role).toBe("user")
    expect(trimmed.at(-1)!.content).toBe("m22")
  })

  test("leaves a short chat alone", () => {
    expect(trimHistory(alternating(5))).toEqual(alternating(5))
  })
})
