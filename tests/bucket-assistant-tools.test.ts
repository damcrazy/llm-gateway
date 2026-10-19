import { describe, expect, test } from "bun:test"

import { describeOp, type BucketsState } from "@/lib/bucket-assistant/ops"
import {
  createWorkspace,
  MAX_LIST_ROWS,
  runTool,
  TOOLS,
} from "@/lib/bucket-assistant/tools"

import { bucketModel, bucketsData } from "./bucket-fixtures"

const empty: BucketsState = {
  buckets: [],
  defaultBucket: null,
  onlyBucketModels: false,
}

const free = bucketModel({ id: "free", name: "Free One", provider: "Google" })
const cheap = bucketModel({
  id: "cheap",
  name: "Cheap",
  provider: "OpenAI",
  inputPrice: 0.1,
  outputPrice: 0.4,
})
const pricey = bucketModel({
  id: "pricey",
  name: "Pricey",
  provider: "Anthropic",
  inputPrice: 3,
  outputPrice: 15,
  capabilities: ["tools", "vision"],
})
const unknown = bucketModel({
  id: "unknown",
  name: "Mystery",
  inputPrice: null,
  outputPrice: null,
})
const embed = bucketModel({
  id: "embed",
  name: "Embed",
  kind: "embedding",
  capabilities: [],
})
const locked = bucketModel({ id: "locked", name: "Locked" })
const models = [pricey, unknown, cheap, free, embed, locked]
const data = bucketsData(models, {
  addable: ["free", "cheap", "pricey", "unknown", "embed"],
})

const workspace = () => createWorkspace(data, empty)
const parse = (content: string) => JSON.parse(content)

test("the tools, in order", () => {
  expect(TOOLS.map((tool) => tool.function.name)).toEqual([
    "list_models",
    "list_buckets",
    "create_bucket",
    "delete_bucket",
    "add_models",
    "remove_models",
    "update_bucket",
    "ask_user",
  ])
})

describe("list_models", () => {
  const slugs = (args: object) =>
    parse(
      runTool(workspace(), "list_models", JSON.stringify(args)).content
    ).models.map((m: { slug: string }) => m.slug)

  test("only addable models, free first, then by price, unknown last", () => {
    expect(slugs({})).toEqual([
      "prov/embed",
      "prov/free",
      "prov/cheap",
      "prov/pricey",
      "prov/unknown",
    ])
  })

  test("filters", () => {
    expect(slugs({ kind: "embedding" })).toEqual(["prov/embed"])
    expect(slugs({ kind: "chat", price: "free" })).toEqual(["prov/free"])
    expect(slugs({ capabilities: ["vision"] })).toEqual(["prov/pricey"])
    expect(slugs({ query: "openai" })).toEqual(["prov/cheap"])
  })

  test(`cuts the list at ${MAX_LIST_ROWS} rows and says so`, () => {
    const lots = Array.from({ length: 70 }, (_, i) =>
      bucketModel({ id: `m${i}` })
    )
    const outcome = runTool(
      createWorkspace(bucketsData(lots), empty),
      "list_models",
      "{}"
    )
    const result = parse(outcome.content)
    expect(result.models).toHaveLength(60)
    expect(result.total).toBe(70)
    expect(result.truncated).toBe(true)
    expect(outcome.step).toBe("Looked at 70 models")
  })
})

describe("change tools", () => {
  test("create_bucket records one op, and list_buckets shows it", () => {
    const ws = workspace()
    const outcome = runTool(
      ws,
      "create_bucket",
      JSON.stringify({ name: "embed", models: ["prov/free", "prov/cheap"] })
    )
    expect(outcome.ok).toBe(true)
    expect(parse(outcome.content)).toEqual({ ok: true, warnings: [] })
    expect(ws.ops).toEqual([
      { type: "create_bucket", name: "embed", modelIds: ["free", "cheap"] },
    ])
    expect(outcome.step).toBe(
      describeOp(ws.ops[0]!, (id) => models.find((m) => m.id === id)!.name)
    )

    const listed = parse(runTool(ws, "list_buckets", "{}").content)
    expect(listed.buckets[0]).toMatchObject({ name: "embed", default: true })
    expect(
      listed.buckets[0].models.map((m: { slug: string }) => m.slug)
    ).toEqual(["prov/free", "prov/cheap"])
  })

  test("an unknown slug is an error naming it", () => {
    const ws = workspace()
    const outcome = runTool(
      ws,
      "create_bucket",
      JSON.stringify({ name: "x", models: ["nope/model"] })
    )
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain("nope/model")
    expect(outcome.step).toBe("Tried a change that didn't fit")
    expect(ws.ops).toEqual([])
  })

  test("malformed arguments leave the workspace alone", () => {
    const ws = workspace()
    const before = structuredClone(ws.state)
    const outcome = runTool(ws, "create_bucket", "{not json")
    expect(outcome.ok).toBe(false)
    expect(outcome.content).toContain("arguments")
    expect(ws.state).toEqual(before)
    expect(ws.ops).toEqual([])
  })

  test("bad argument shapes are reported", () => {
    const outcome = runTool(
      workspace(),
      "create_bucket",
      JSON.stringify({ models: 3 })
    )
    expect(outcome.ok).toBe(false)
    expect(parse(outcome.content).error).toStartWith("Bad arguments:")
  })

  test("mixing kinds comes back as a loud warning", () => {
    const outcome = runTool(
      workspace(),
      "create_bucket",
      JSON.stringify({ name: "x", models: ["prov/free", "prov/embed"] })
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.content).toContain(
      "This bucket mixes chat and embedding models"
    )
  })
})

test("an unknown tool is an error", () => {
  expect(runTool(workspace(), "drop_tables", "{}").ok).toBe(false)
})

describe("ask_user", () => {
  test("returns the question", () => {
    const outcome = runTool(
      workspace(),
      "ask_user",
      JSON.stringify({
        question: "Free only?",
        options: ["Free only", "Paid is fine"],
      })
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.question).toEqual({
      text: "Free only?",
      options: ["Free only", "Paid is fine"],
    })
  })

  test("needs at least two options", () => {
    expect(
      runTool(
        workspace(),
        "ask_user",
        JSON.stringify({ question: "Free only?", options: ["Yes"] })
      ).ok
    ).toBe(false)
  })
})
