// Shapes shared by the app's Models tab (server page -> client components).

import type { BucketStrategy } from "@/lib/db/types"
import type { Capability } from "@/lib/providers/catalog"

export type { BucketStrategy }

export const STRATEGY_OPTIONS: {
  value: BucketStrategy
  label: string
  help: string
}[] = [
  {
    value: "ordered",
    label: "In order",
    help: "Tries the models top to bottom.",
  },
  {
    value: "fastest",
    label: "Fastest first",
    help: "Orders by each model's recent time to first token.",
  },
  {
    value: "cheapest",
    label: "Cheapest first",
    help: "Orders by price per token.",
  },
  {
    value: "spread",
    label: "Spread evenly",
    help: "Rotates which model goes first, to share the load.",
  },
]

export const HEDGE_OPTIONS = [
  { value: "off", label: "No hedge", ms: null },
  { value: "1000", label: "Hedge 1 s", ms: 1000 },
  { value: "2000", label: "Hedge 2 s", ms: 2000 },
  { value: "5000", label: "Hedge 5 s", ms: 5000 },
  { value: "10000", label: "Hedge 10 s", ms: 10000 },
] as const

export type ModelStatus =
  | { kind: "ok" }
  | { kind: "cooling"; label: string }
  | { kind: "unavailable"; label: string }

/** This app's usage of one model in the current calendar month. */
export interface ModelUsage {
  requests: number
  errors: number
  tokens: number
  costUsd: number
}

export interface BucketModel {
  id: string
  slug: string
  /** Display name, or the upstream model id. */
  name: string
  provider: string
  /** From the app owner's own (private) provider. */
  own: boolean
  kind: "chat" | "embedding"
  capabilities: Capability[]
  contextWindow: number | null
  inputPrice: number | null
  outputPrice: number | null
  status: ModelStatus
  usage: ModelUsage | null
}

export interface BucketsData {
  /** Every model the tab may show: addable ones and any already in buckets. */
  models: BucketModel[]
  /** Ids of models the app's owner may add (enabled and allowed). */
  addable: string[]
  buckets: {
    name: string
    modelIds: string[]
    strategy: BucketStrategy
    hedgeAfterMs: number | null
  }[]
  defaultBucket: string | null
  onlyBucketModels: boolean
  /** e.g. "free models only", when the owner's access is limited. */
  ownerAccess: string | null
}

/** Drag payload type for rows dragged from the model table onto a bucket. */
export const MODEL_DRAG_TYPE = "application/x-gateway-model"
