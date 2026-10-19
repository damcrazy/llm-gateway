// What the bucket assistant panel sends each turn and gets back (pure,
// server and client safe). The server re-validates everything it receives.

import { z } from "zod"

import { MAX_BUCKET_MODELS, MAX_BUCKETS } from "@/app/(dashboard)/apps/_lib"
import { STRATEGY_OPTIONS } from "@/app/(dashboard)/apps/[id]/buckets-shared"

import type { AssistantOp, BucketsState, KindWarning } from "./ops"

export const MAX_HISTORY = 20
export const MAX_MESSAGE_CHARS = 4000
export const MAX_PENDING_OPS = 50

const strategy = z.enum(
  STRATEGY_OPTIONS.map((option) => option.value) as [
    BucketsState["buckets"][number]["strategy"],
    ...BucketsState["buckets"][number]["strategy"][],
  ]
)
const name = z.string().max(80)
const modelIds = z.array(z.string().max(100)).max(MAX_BUCKET_MODELS * 2)
const hedge = z.number().int().nullable()

export const assistantOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_bucket"),
    name,
    modelIds,
    strategy: strategy.optional(),
    hedgeAfterMs: hedge.optional(),
    makeDefault: z.boolean().optional(),
  }),
  z.object({ type: z.literal("delete_bucket"), name }),
  z.object({
    type: z.literal("add_models"),
    bucket: name,
    modelIds,
    position: z.number().int().min(1).optional(),
  }),
  z.object({ type: z.literal("remove_models"), bucket: name, modelIds }),
  z.object({
    type: z.literal("update_bucket"),
    bucket: name,
    newName: name.optional(),
    strategy: strategy.optional(),
    hedgeAfterMs: hedge.optional(),
    modelOrder: modelIds.optional(),
    makeDefault: z.boolean().optional(),
  }),
]) satisfies z.ZodType<AssistantOp>

export const bucketsStateSchema = z.object({
  buckets: z
    .array(
      z.object({
        name,
        modelIds: z.array(z.string().max(100)).max(MAX_BUCKET_MODELS),
        strategy,
        hedgeAfterMs: hedge,
      })
    )
    .max(MAX_BUCKETS),
  defaultBucket: name.nullable(),
  onlyBucketModels: z.boolean(),
}) satisfies z.ZodType<BucketsState>

export const assistantTurnInputSchema = z.object({
  /** A bucket name or a model slug, from the Runs on picker. */
  runsOn: z.string().trim().min(1, "Pick a model to run on").max(256),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z
          .string()
          .max(
            MAX_MESSAGE_CHARS,
            `Keep messages under ${MAX_MESSAGE_CHARS} characters`
          ),
      })
    )
    .min(1)
    .max(MAX_HISTORY),
  board: bucketsStateSchema,
  pendingOps: z.array(assistantOpSchema).max(MAX_PENDING_OPS),
})

export type AssistantTurnInput = z.infer<typeof assistantTurnInputSchema>

/**
 * The last MAX_HISTORY messages, opening on a user message: some providers
 * (Anthropic, Gemini) reject a conversation that starts with the assistant.
 */
export function trimHistory<T extends { role: "user" | "assistant" }>(
  messages: T[]
): T[] {
  const window = messages.slice(-MAX_HISTORY)
  const firstUser = window.findIndex((message) => message.role === "user")
  return firstUser < 0 ? [] : window.slice(firstUser)
}

export interface AssistantProposal {
  ops: AssistantOp[]
  /** One plain sentence per op. */
  lines: string[]
  warnings: KindWarning[]
}

export interface AssistantTurnResult {
  reply: string
  question?: { text: string; options: string[] }
  /** "Looked at 34 models", … */
  steps: string[]
  /** ops empty: nothing proposed. */
  proposal: AssistantProposal
  usage: {
    calls: number
    inputTokens: number
    outputTokens: number
    /** undefined when any call's price was unknown */
    costUsd?: number
  }
}
