// Bucket changes the assistant proposes, and the rules they must follow
// (pure, server and client safe). The server tries each change on a draft
// so the assistant hears about mistakes straight away; the browser replays
// the same changes on the board when the user clicks Apply. saveAppBuckets
// still checks everything again when the board saves.

import {
  BUCKET_NAME_PATTERN,
  MAX_BUCKET_MODELS,
  MAX_BUCKETS,
  toBucketName,
} from "@/app/(dashboard)/apps/_lib"
import {
  STRATEGY_OPTIONS,
  type BucketStrategy,
} from "@/app/(dashboard)/apps/[id]/buckets-shared"
import { bucketKindMix, mixWarningText } from "@/lib/bucket-kinds"
import type { ModelKind } from "@/lib/db/types"

export interface StateBucket {
  name: string
  modelIds: string[]
  strategy: BucketStrategy
  hedgeAfterMs: number | null
}

/** An app's buckets by name, in board order (the shape saveAppBuckets takes). */
export interface BucketsState {
  buckets: StateBucket[]
  defaultBucket: string | null
  onlyBucketModels: boolean
}

export type AssistantOp =
  | {
      type: "create_bucket"
      name: string
      modelIds: string[]
      strategy?: BucketStrategy
      hedgeAfterMs?: number | null
      makeDefault?: boolean
    }
  | { type: "delete_bucket"; name: string }
  | {
      type: "add_models"
      bucket: string
      modelIds: string[]
      /** 1-based; appended when missing. */
      position?: number
    }
  | { type: "remove_models"; bucket: string; modelIds: string[] }
  | {
      type: "update_bucket"
      bucket: string
      newName?: string
      strategy?: BucketStrategy
      hedgeAfterMs?: number | null
      modelOrder?: string[]
      makeDefault?: boolean
    }

export interface KindWarning {
  bucket: string
  title: string
  body: string
}

export interface OpContext {
  /** Models the app's owner may add. */
  addable: ReadonlySet<string>
  models: ReadonlyMap<string, { id: string; name: string; kind: ModelKind }>
}

export type OpResult =
  | {
      ok: true
      state: BucketsState
      /** The change as applied, with names normalized. */
      op: AssistantOp
      warnings: KindWarning[]
    }
  | { ok: false; error: string }

const MIN_HEDGE_MS = 250
const MAX_HEDGE_MS = 60_000

export function opContext(
  models: { id: string; name: string; kind: ModelKind }[],
  addable: Iterable<string>
): OpContext {
  return {
    addable: new Set(addable),
    models: new Map(
      models.map((m) => [m.id, { id: m.id, name: m.name, kind: m.kind }])
    ),
  }
}

class OpError extends Error {}

const fail = (message: string): never => {
  throw new OpError(message)
}

function modelName(ctx: OpContext, id: string): string {
  return ctx.models.get(id)?.name ?? id
}

function checkName(name: string, taken: string[]): string {
  if (!name)
    fail(
      "Give the bucket a name: lowercase letters, numbers, dots, dashes and underscores"
    )
  if (name === "default")
    fail('"default" is reserved: clients send it to mean the default bucket')
  if (!BUCKET_NAME_PATTERN.test(name))
    fail(`"${name}" must start with a letter or number`)
  if (taken.includes(name)) fail(`Another bucket is already named "${name}"`)
  return name
}

function checkHedge(ms: number | null | undefined) {
  if (ms != null && !(ms >= MIN_HEDGE_MS && ms <= MAX_HEDGE_MS))
    fail(
      `Hedging must be off or between ${MIN_HEDGE_MS} and ${MAX_HEDGE_MS} ms`
    )
}

/** New models: known and addable. Duplicates are dropped. */
function checkNewModels(ctx: OpContext, ids: string[]): string[] {
  const unique = [...new Set(ids)]
  for (const id of unique) {
    if (!ctx.models.has(id)) fail(`Unknown model ${id}`)
    if (!ctx.addable.has(id))
      fail(`${modelName(ctx, id)} isn't available to this app's owner`)
  }
  return unique
}

function checkSize(ids: string[]) {
  if (ids.length > MAX_BUCKET_MODELS)
    fail(`A bucket holds at most ${MAX_BUCKET_MODELS} models`)
}

function findBucket(state: BucketsState, name: string): number {
  const exact = state.buckets.findIndex((b) => b.name === name)
  const index =
    exact >= 0
      ? exact
      : state.buckets.findIndex((b) => b.name === toBucketName(name))
  if (index < 0) fail(`There's no bucket named "${name}"`)
  return index
}

function warningsFor(
  state: BucketsState,
  names: string[],
  ctx: OpContext
): KindWarning[] {
  const warnings: KindWarning[] = []
  for (const name of new Set(names)) {
    const bucket = state.buckets.find((b) => b.name === name)
    if (!bucket) continue
    const mix = bucketKindMix(
      bucket.modelIds.flatMap((id) => {
        const model = ctx.models.get(id)
        return model ? [model] : []
      })
    )
    if (mix) warnings.push({ bucket: name, ...mixWarningText(name, mix) })
  }
  return warnings
}

function run(
  state: BucketsState,
  op: AssistantOp,
  ctx: OpContext
): { state: BucketsState; op: AssistantOp; touched: string[] } {
  const buckets = state.buckets.map((b) => ({
    ...b,
    modelIds: [...b.modelIds],
  }))
  const names = buckets.map((b) => b.name)

  switch (op.type) {
    case "create_bucket": {
      const name = checkName(toBucketName(op.name), names)
      if (buckets.length >= MAX_BUCKETS)
        fail(`An app can have at most ${MAX_BUCKETS} buckets`)
      const modelIds = checkNewModels(ctx, op.modelIds)
      checkSize(modelIds)
      checkHedge(op.hedgeAfterMs)
      buckets.push({
        name,
        modelIds,
        strategy: op.strategy ?? "ordered",
        hedgeAfterMs: op.hedgeAfterMs ?? null,
      })
      return {
        state: {
          ...state,
          buckets,
          // The first bucket becomes the default, as on the board.
          defaultBucket: op.makeDefault ? name : (state.defaultBucket ?? name),
        },
        op: { ...op, name, modelIds },
        touched: [name],
      }
    }

    case "delete_bucket": {
      const index = findBucket(state, op.name)
      const name = buckets[index]!.name
      buckets.splice(index, 1)
      return {
        state: {
          ...state,
          buckets,
          defaultBucket:
            state.defaultBucket === name ? null : state.defaultBucket,
        },
        op: { ...op, name },
        touched: [],
      }
    }

    case "add_models": {
      const index = findBucket(state, op.bucket)
      const target = buckets[index]!
      const added = checkNewModels(ctx, op.modelIds).filter(
        (id) => !target.modelIds.includes(id)
      )
      // Saying "added" for models already there would mislead the user.
      if (!added.length) {
        const names = [...new Set(op.modelIds)].map((id) => modelName(ctx, id))
        fail(
          `${names.join(", ")} ${names.length === 1 ? "is" : "are"} already in "${target.name}"`
        )
      }
      const at =
        op.position == null
          ? target.modelIds.length
          : Math.min(Math.max(op.position - 1, 0), target.modelIds.length)
      target.modelIds.splice(at, 0, ...added)
      checkSize(target.modelIds)
      return {
        state: { ...state, buckets },
        op: { ...op, bucket: target.name, modelIds: added },
        touched: [target.name],
      }
    }

    case "remove_models": {
      const index = findBucket(state, op.bucket)
      const target = buckets[index]!
      const removed = [...new Set(op.modelIds)]
      for (const id of removed) {
        if (!target.modelIds.includes(id))
          fail(`${modelName(ctx, id)} isn't in "${target.name}"`)
      }
      target.modelIds = target.modelIds.filter((id) => !removed.includes(id))
      return {
        state: { ...state, buckets },
        op: { ...op, bucket: target.name, modelIds: removed },
        touched: [target.name],
      }
    }

    case "update_bucket": {
      const index = findBucket(state, op.bucket)
      const target = buckets[index]!
      const oldName = target.name
      let defaultBucket = state.defaultBucket
      let newName: string | undefined
      if (op.newName !== undefined) {
        const candidate = toBucketName(op.newName)
        if (candidate !== oldName) {
          newName = checkName(
            candidate,
            names.filter((n) => n !== oldName)
          )
          target.name = newName
          if (defaultBucket === oldName) defaultBucket = newName
        }
      }
      if (op.strategy) target.strategy = op.strategy
      if (op.hedgeAfterMs !== undefined) {
        checkHedge(op.hedgeAfterMs)
        target.hedgeAfterMs = op.hedgeAfterMs
      }
      if (op.modelOrder) {
        const order = op.modelOrder
        const same =
          order.length === target.modelIds.length &&
          new Set(order).size === order.length &&
          order.every((id) => target.modelIds.includes(id))
        if (!same)
          fail(
            `The new order for "${oldName}" must list exactly its current models`
          )
        target.modelIds = [...order]
      }
      if (op.makeDefault === true) defaultBucket = target.name
      if (op.makeDefault === false && defaultBucket === target.name)
        defaultBucket = null
      const before = state.buckets[index]!
      if (
        target.name === before.name &&
        target.strategy === before.strategy &&
        target.hedgeAfterMs === before.hedgeAfterMs &&
        target.modelIds.join() === before.modelIds.join() &&
        defaultBucket === state.defaultBucket
      )
        fail(`Nothing to change in "${oldName}"`)
      const applied = { ...op, bucket: oldName }
      // A "rename" to the current name isn't one.
      delete applied.newName
      if (newName !== undefined) applied.newName = newName
      return {
        state: { ...state, buckets, defaultBucket },
        op: applied,
        touched: [target.name],
      }
    }
  }
}

export function applyOp(
  state: BucketsState,
  op: AssistantOp,
  ctx: OpContext
): OpResult {
  try {
    const result = run(state, op, ctx)
    return {
      ok: true,
      state: result.state,
      op: result.op,
      warnings: warningsFor(result.state, result.touched, ctx),
    }
  } catch (error) {
    if (error instanceof OpError) return { ok: false, error: error.message }
    throw error
  }
}

/** Applies what still fits, in order; the rest is skipped with a reason. */
export function applyOps(
  state: BucketsState,
  ops: AssistantOp[],
  ctx: OpContext
): {
  state: BucketsState
  applied: AssistantOp[]
  skipped: { op: AssistantOp; error: string }[]
} {
  let current = state
  const applied: AssistantOp[] = []
  const skipped: { op: AssistantOp; error: string }[] = []
  for (const op of ops) {
    const result = applyOp(current, op, ctx)
    if (result.ok) {
      current = result.state
      applied.push(result.op)
    } else {
      skipped.push({ op, error: result.error })
    }
  }
  return { state: current, applied, skipped }
}

/** Buckets the proposal touches that end up holding more than one kind. */
export function proposalWarnings(
  state: BucketsState,
  ops: AssistantOp[],
  ctx: OpContext
): KindWarning[] {
  const touched = ops.flatMap((op) => {
    switch (op.type) {
      case "create_bucket":
        return [op.name]
      case "delete_bucket":
        return []
      case "update_bucket":
        return op.newName ? [op.bucket, op.newName] : [op.bucket]
      default:
        return [op.bucket]
    }
  })
  return warningsFor(state, touched, ctx)
}

const numbered = (ids: string[], nameOf: (id: string) => string) =>
  ids.map((id, i) => `${i + 1}. ${nameOf(id)}`).join(", ")

/** One line per change, for the proposal card and the assistant's steps. */
export function describeOp(
  op: AssistantOp,
  nameOf: (id: string) => string
): string {
  switch (op.type) {
    case "create_bucket": {
      const models = op.modelIds.length
        ? `: ${numbered(op.modelIds, nameOf)}`
        : " (empty)"
      return `Create bucket "${op.name}"${models}${op.makeDefault ? " · make it the default" : ""}`
    }
    case "delete_bucket":
      return `Delete bucket "${op.name}"`
    case "add_models":
      return `Add ${op.modelIds.map(nameOf).join(", ")} to "${op.bucket}"${op.position != null ? ` at position ${op.position}` : ""}`
    case "remove_models":
      return `Remove ${op.modelIds.map(nameOf).join(", ")} from "${op.bucket}"`
    case "update_bucket": {
      const parts: string[] = []
      if (op.newName !== undefined) parts.push(`rename to "${op.newName}"`)
      if (op.strategy) {
        const label =
          STRATEGY_OPTIONS.find((o) => o.value === op.strategy)?.label ??
          op.strategy
        parts.push(`order: ${label}`)
      }
      if (op.hedgeAfterMs !== undefined)
        parts.push(
          op.hedgeAfterMs == null
            ? "no hedging"
            : `hedge after ${op.hedgeAfterMs / 1000} s`
        )
      if (op.modelOrder)
        parts.push(`models in order ${numbered(op.modelOrder, nameOf)}`)
      if (op.makeDefault === true) parts.push("make it the default")
      if (op.makeDefault === false) parts.push("stop being the default")
      return `Update "${op.bucket}": ${parts.join(", ")}`
    }
  }
}
