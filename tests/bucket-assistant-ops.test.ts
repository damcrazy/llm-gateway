import { describe, expect, test } from "bun:test"

import { toBucketName } from "@/app/(dashboard)/apps/_lib"
import {
  applyOp,
  applyOps,
  describeOp,
  opContext,
  proposalWarnings,
  type AssistantOp,
  type BucketsState,
  type StateBucket,
} from "@/lib/bucket-assistant/ops"

import { bucketModel } from "./bucket-fixtures"

const chatA = bucketModel({ id: "a", name: "A" })
const chatB = bucketModel({ id: "b", name: "B" })
const chatC = bucketModel({ id: "c", name: "C" })
const embed = bucketModel({ id: "e", name: "E", kind: "embedding" })
const retired = bucketModel({ id: "r", name: "Retired" })
const many = Array.from({ length: 30 }, (_, i) =>
  bucketModel({ id: `m${i}`, name: `M${i}` })
)
const all = [chatA, chatB, chatC, embed, retired, ...many]
// "Retired" is shown but no longer addable.
const ctx = opContext(
  all,
  all.filter((m) => m.id !== "r").map((m) => m.id)
)
const nameOf = (id: string) => all.find((m) => m.id === id)?.name ?? id

const bucket = (
  name: string,
  modelIds: string[] = [],
  extra: Partial<StateBucket> = {}
): StateBucket => ({
  name,
  modelIds,
  strategy: "ordered",
  hedgeAfterMs: null,
  ...extra,
})
const state = (
  buckets: StateBucket[],
  defaultBucket: string | null = null
): BucketsState => ({ buckets, defaultBucket, onlyBucketModels: false })

function ok(result: ReturnType<typeof applyOp>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result
}
function err(result: ReturnType<typeof applyOp>) {
  if (result.ok) throw new Error("expected an error")
  return result.error
}

describe("create_bucket", () => {
  test("defaults, and the first bucket becomes the default", () => {
    const result = ok(
      applyOp(
        state([]),
        { type: "create_bucket", name: "embed", modelIds: ["a"] },
        ctx
      )
    )
    expect(result.state.buckets).toEqual([bucket("embed", ["a"])])
    expect(result.state.defaultBucket).toBe("embed")
    expect(result.warnings).toEqual([])
  })

  test("keeps an existing default unless makeDefault", () => {
    const start = state([bucket("smart")], "smart")
    const kept = ok(
      applyOp(start, { type: "create_bucket", name: "fast", modelIds: [] }, ctx)
    )
    expect(kept.state.defaultBucket).toBe("smart")
    const moved = ok(
      applyOp(
        start,
        {
          type: "create_bucket",
          name: "fast",
          modelIds: [],
          makeDefault: true,
        },
        ctx
      )
    )
    expect(moved.state.defaultBucket).toBe("fast")
  })

  test("strategy and hedging", () => {
    const result = ok(
      applyOp(
        state([]),
        {
          type: "create_bucket",
          name: "fast",
          modelIds: [],
          strategy: "cheapest",
          hedgeAfterMs: 2000,
        },
        ctx
      )
    )
    expect(result.state.buckets[0]).toEqual(
      bucket("fast", [], { strategy: "cheapest", hedgeAfterMs: 2000 })
    )
  })

  test("normalizes human-style names everywhere", () => {
    const result = ok(
      applyOp(
        state([]),
        { type: "create_bucket", name: "My Embeddings!", modelIds: ["e"] },
        ctx
      )
    )
    const normalized = toBucketName("My Embeddings!")
    expect(result.state.buckets[0]!.name).toBe(normalized)
    expect(result.op).toMatchObject({ type: "create_bucket", name: normalized })
    expect(describeOp(result.op, nameOf)).toBe(
      `Create bucket "${normalized}": 1. E`
    )
  })

  test("name errors", () => {
    const start = state([bucket("smart")], "smart")
    const create = (name: string) =>
      applyOp(start, { type: "create_bucket", name, modelIds: [] }, ctx)
    expect(err(create("default"))).toContain("reserved")
    expect(err(create("smart"))).toContain("already")
    expect(create("---").ok).toBe(false)
  })

  test("bucket and model limits", () => {
    const twenty = state(Array.from({ length: 20 }, (_, i) => bucket(`b${i}`)))
    expect(
      err(
        applyOp(
          twenty,
          { type: "create_bucket", name: "one-more", modelIds: [] },
          ctx
        )
      )
    ).toContain("20")
    expect(
      err(
        applyOp(
          state([]),
          {
            type: "create_bucket",
            name: "big",
            modelIds: many.slice(0, 26).map((m) => m.id),
          },
          ctx
        )
      )
    ).toContain("25")
  })

  test("models must be addable", () => {
    expect(
      err(
        applyOp(
          state([]),
          { type: "create_bucket", name: "x", modelIds: ["r"] },
          ctx
        )
      )
    ).toContain("Retired")
  })

  test("warns loudly when the bucket mixes kinds", () => {
    const result = ok(
      applyOp(
        state([]),
        { type: "create_bucket", name: "x", modelIds: ["a", "e"] },
        ctx
      )
    )
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({
      bucket: "x",
      title: "This bucket mixes chat and embedding models",
    })
  })
})

describe("add_models", () => {
  const start = state([bucket("smart", ["a"])], "smart")

  test("appends, ignoring models already there", () => {
    const result = ok(
      applyOp(
        start,
        { type: "add_models", bucket: "smart", modelIds: ["a", "b"] },
        ctx
      )
    )
    expect(result.state.buckets[0]!.modelIds).toEqual(["a", "b"])
  })

  test("adding only models already there is an error", () => {
    expect(
      err(
        applyOp(
          start,
          { type: "add_models", bucket: "smart", modelIds: ["a"] },
          ctx
        )
      )
    ).toContain("already in")
  })

  test("inserts at a 1-based position", () => {
    const result = ok(
      applyOp(
        start,
        {
          type: "add_models",
          bucket: "smart",
          modelIds: ["b", "c"],
          position: 1,
        },
        ctx
      )
    )
    expect(result.state.buckets[0]!.modelIds).toEqual(["b", "c", "a"])
  })

  test("can't go over 25 models", () => {
    expect(
      err(
        applyOp(
          start,
          {
            type: "add_models",
            bucket: "smart",
            modelIds: many.slice(0, 25).map((m) => m.id),
          },
          ctx
        )
      )
    ).toContain("25")
  })

  test("names a missing bucket", () => {
    expect(
      err(
        applyOp(
          start,
          { type: "add_models", bucket: "fast", modelIds: ["b"] },
          ctx
        )
      )
    ).toContain('"fast"')
  })
})

describe("remove_models", () => {
  const start = state([bucket("smart", ["a", "b"])])

  test("removes them", () => {
    const result = ok(
      applyOp(
        start,
        { type: "remove_models", bucket: "smart", modelIds: ["a"] },
        ctx
      )
    )
    expect(result.state.buckets[0]!.modelIds).toEqual(["b"])
  })

  test("a model that isn't in the bucket is an error", () => {
    expect(
      err(
        applyOp(
          start,
          { type: "remove_models", bucket: "smart", modelIds: ["c"] },
          ctx
        )
      )
    ).toContain("C")
  })
})

describe("update_bucket", () => {
  const start = state(
    [bucket("smart", ["a", "b", "r"]), bucket("fast")],
    "smart"
  )

  test("rename keeps it the default", () => {
    const result = ok(
      applyOp(
        start,
        { type: "update_bucket", bucket: "smart", newName: "clever" },
        ctx
      )
    )
    expect(result.state.buckets[0]!.name).toBe("clever")
    expect(result.state.defaultBucket).toBe("clever")
  })

  test("renaming to the current name is no rename", () => {
    const result = ok(
      applyOp(
        start,
        {
          type: "update_bucket",
          bucket: "smart",
          newName: "Smart",
          strategy: "spread",
        },
        ctx
      )
    )
    expect(result.op).not.toHaveProperty("newName")
    expect(result.state.buckets[0]!.name).toBe("smart")
  })

  test("an update that changes nothing is an error", () => {
    expect(
      err(applyOp(start, { type: "update_bucket", bucket: "smart" }, ctx))
    ).toContain("Nothing to change")
    expect(
      err(
        applyOp(
          start,
          { type: "update_bucket", bucket: "smart", newName: "smart" },
          ctx
        )
      )
    ).toContain("Nothing to change")
  })

  test("can't rename to a taken name", () => {
    expect(
      err(
        applyOp(
          start,
          { type: "update_bucket", bucket: "smart", newName: "fast" },
          ctx
        )
      )
    ).toContain("already")
  })

  test("strategy and hedge range", () => {
    const result = ok(
      applyOp(
        start,
        {
          type: "update_bucket",
          bucket: "fast",
          strategy: "spread",
          hedgeAfterMs: 2000,
        },
        ctx
      )
    )
    expect(result.state.buckets[1]).toMatchObject({
      strategy: "spread",
      hedgeAfterMs: 2000,
    })
    expect(
      applyOp(
        start,
        { type: "update_bucket", bucket: "fast", hedgeAfterMs: 100 },
        ctx
      ).ok
    ).toBe(false)
  })

  test("reorders with a permutation, keeping models that are no longer addable", () => {
    const result = ok(
      applyOp(
        start,
        { type: "update_bucket", bucket: "smart", modelOrder: ["r", "b", "a"] },
        ctx
      )
    )
    expect(result.state.buckets[0]!.modelIds).toEqual(["r", "b", "a"])
    expect(
      applyOp(
        start,
        { type: "update_bucket", bucket: "smart", modelOrder: ["a", "b"] },
        ctx
      ).ok
    ).toBe(false)
  })

  test("makeDefault true and false", () => {
    const moved = ok(
      applyOp(
        start,
        { type: "update_bucket", bucket: "fast", makeDefault: true },
        ctx
      )
    )
    expect(moved.state.defaultBucket).toBe("fast")
    // "fast" isn't the default, so there's nothing to stop.
    expect(
      err(
        applyOp(
          start,
          { type: "update_bucket", bucket: "fast", makeDefault: false },
          ctx
        )
      )
    ).toContain("Nothing to change")
    const cleared = ok(
      applyOp(
        start,
        { type: "update_bucket", bucket: "smart", makeDefault: false },
        ctx
      )
    )
    expect(cleared.state.defaultBucket).toBeNull()
  })
})

describe("delete_bucket", () => {
  test("clears the default", () => {
    const result = ok(
      applyOp(
        state([bucket("smart")], "smart"),
        { type: "delete_bucket", name: "smart" },
        ctx
      )
    )
    expect(result.state.buckets).toEqual([])
    expect(result.state.defaultBucket).toBeNull()
  })

  test("names an unknown bucket", () => {
    expect(
      err(applyOp(state([]), { type: "delete_bucket", name: "old" }, ctx))
    ).toContain('"old"')
  })
})

test("never mutates the input state", () => {
  const start = state([bucket("smart", ["a"])], "smart")
  const copy = structuredClone(start)
  applyOp(start, { type: "add_models", bucket: "smart", modelIds: ["b"] }, ctx)
  applyOp(start, { type: "delete_bucket", name: "smart" }, ctx)
  expect(start).toEqual(copy)
})

test("applyOps skips what no longer fits and applies the rest", () => {
  const result = applyOps(
    state([bucket("smart")]),
    [
      { type: "add_models", bucket: "fast", modelIds: ["a"] },
      { type: "create_bucket", name: "embed", modelIds: ["e"] },
    ],
    ctx
  )
  expect(result.applied).toHaveLength(1)
  expect(result.skipped).toHaveLength(1)
  expect(result.skipped[0]!.error).toContain('"fast"')
  expect(result.state.buckets.map((b) => b.name)).toEqual(["smart", "embed"])
})

test("proposalWarnings reports touched mixed buckets only", () => {
  const ops: AssistantOp[] = [
    { type: "create_bucket", name: "x", modelIds: ["a", "e"] },
  ]
  const after = applyOps(state([bucket("old-mix", ["b", "e"])]), ops, ctx).state
  const warnings = proposalWarnings(after, ops, ctx)
  expect(warnings.map((w) => w.bucket)).toEqual(["x"])
})

describe("describeOp", () => {
  test("each kind of change", () => {
    expect(
      describeOp(
        { type: "create_bucket", name: "embed", modelIds: ["a", "b"] },
        nameOf
      )
    ).toBe('Create bucket "embed": 1. A, 2. B')
    expect(
      describeOp({ type: "create_bucket", name: "x", modelIds: [] }, nameOf)
    ).toBe('Create bucket "x" (empty)')
    expect(
      describeOp(
        {
          type: "create_bucket",
          name: "x",
          modelIds: ["a"],
          makeDefault: true,
        },
        nameOf
      )
    ).toBe('Create bucket "x": 1. A · make it the default')
    expect(describeOp({ type: "delete_bucket", name: "old" }, nameOf)).toBe(
      'Delete bucket "old"'
    )
    expect(
      describeOp(
        { type: "add_models", bucket: "smart", modelIds: ["a", "b"] },
        nameOf
      )
    ).toBe('Add A, B to "smart"')
    expect(
      describeOp(
        { type: "add_models", bucket: "smart", modelIds: ["a"], position: 1 },
        nameOf
      )
    ).toBe('Add A to "smart" at position 1')
    expect(
      describeOp(
        { type: "remove_models", bucket: "smart", modelIds: ["a"] },
        nameOf
      )
    ).toBe('Remove A from "smart"')
    expect(
      describeOp(
        {
          type: "update_bucket",
          bucket: "smart",
          newName: "fast",
          strategy: "cheapest",
          hedgeAfterMs: 2000,
          modelOrder: ["a", "b"],
          makeDefault: true,
        },
        nameOf
      )
    ).toBe(
      'Update "smart": rename to "fast", order: Cheapest first, hedge after 2 s, models in order 1. A, 2. B, make it the default'
    )
    expect(
      describeOp(
        {
          type: "update_bucket",
          bucket: "smart",
          hedgeAfterMs: null,
          makeDefault: false,
        },
        nameOf
      )
    ).toBe('Update "smart": no hedging, stop being the default')
  })
})
