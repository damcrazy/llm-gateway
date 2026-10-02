// Shapes shared by the app's Models tab (server page -> client components).

import type { Capability } from "@/lib/providers/catalog"

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
  buckets: { name: string; modelIds: string[] }[]
  defaultBucket: string | null
  onlyBucketModels: boolean
  /** e.g. "free models only", when the owner's access is limited. */
  ownerAccess: string | null
}

/** Drag payload type for rows dragged from the model table onto a bucket. */
export const MODEL_DRAG_TYPE = "application/x-gateway-model"
