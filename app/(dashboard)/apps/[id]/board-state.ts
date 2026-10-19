// The Models tab's board state, and converting it to and from bucket names
// (pure: no React, server and client safe).

import type { BucketsState } from "@/lib/bucket-assistant/ops"

import type { BucketStrategy, BucketsData } from "./buckets-shared"

/** One model's place in a bucket. `key` is unique across the whole board. */
export interface BoardItem {
  key: string
  modelId: string
}

export interface BucketSettings {
  strategy: BucketStrategy
  hedgeAfterMs: number | null
}

export interface Board {
  /** Bucket key -> its models in fallback order. Key order = bucket order. */
  columns: Record<string, BoardItem[]>
  /** Bucket key -> name. Keys stay stable when a bucket is renamed. */
  names: Record<string, string>
  /** Bucket key -> strategy and hedging. */
  settings: Record<string, BucketSettings>
  defaultKey: string | null
  onlyBuckets: boolean
}

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error"

let keySequence = 0
export const makeKey = (prefix: string) => `${prefix}${++keySequence}`

export function initialBoard(
  data: Pick<BucketsData, "buckets" | "defaultBucket" | "onlyBucketModels">
): Board {
  const columns: Board["columns"] = {}
  const names: Board["names"] = {}
  const settings: Board["settings"] = {}
  let defaultKey: string | null = null
  for (const bucket of data.buckets) {
    const key = makeKey("bucket-")
    columns[key] = bucket.modelIds.map((modelId) => ({
      key: makeKey(`${modelId}@`),
      modelId,
    }))
    names[key] = bucket.name
    settings[key] = {
      strategy: bucket.strategy,
      hedgeAfterMs: bucket.hedgeAfterMs,
    }
    if (bucket.name === data.defaultBucket) defaultKey = key
  }
  return {
    columns,
    names,
    settings,
    defaultKey,
    onlyBuckets: data.onlyBucketModels,
  }
}

export function toInput(board: Board): BucketsState {
  return {
    buckets: Object.entries(board.columns).map(([key, items]) => ({
      name: board.names[key] ?? "",
      modelIds: items.map((item) => item.modelId),
      strategy: board.settings[key]?.strategy ?? "ordered",
      hedgeAfterMs: board.settings[key]?.hedgeAfterMs ?? null,
    })),
    defaultBucket: board.defaultKey
      ? (board.names[board.defaultKey] ?? null)
      : null,
    onlyBucketModels: board.onlyBuckets,
  }
}

/** The first bucket holding a model twice, if any. */
export function duplicateIn(board: Board): string | null {
  for (const [key, items] of Object.entries(board.columns)) {
    const ids = items.map((item) => item.modelId)
    if (new Set(ids).size !== ids.length) return key
  }
  return null
}

/**
 * The board for a new bucket state, keeping `previous` keys for buckets with
 * the same name and items with the same model, so unchanged cards stay put.
 */
export function stateToBoard(state: BucketsState, previous: Board): Board {
  const keyByName = new Map(
    Object.entries(previous.names).map(([key, name]) => [name, key])
  )
  const columns: Board["columns"] = {}
  const names: Board["names"] = {}
  const settings: Board["settings"] = {}
  let defaultKey: string | null = null
  for (const bucket of state.buckets) {
    const reused = keyByName.get(bucket.name)
    const key = reused && !(reused in columns) ? reused : makeKey("bucket-")
    const itemKeyByModel = new Map(
      (reused ? (previous.columns[reused] ?? []) : []).map((item) => [
        item.modelId,
        item.key,
      ])
    )
    columns[key] = bucket.modelIds.map((modelId) => ({
      key: itemKeyByModel.get(modelId) ?? makeKey(`${modelId}@`),
      modelId,
    }))
    names[key] = bucket.name
    settings[key] = {
      strategy: bucket.strategy,
      hedgeAfterMs: bucket.hedgeAfterMs,
    }
    if (bucket.name === state.defaultBucket) defaultKey = key
  }
  return {
    columns,
    names,
    settings,
    defaultKey,
    onlyBuckets: state.onlyBucketModels,
  }
}
