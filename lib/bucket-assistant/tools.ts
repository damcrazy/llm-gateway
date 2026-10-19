// The bucket assistant's tools: two that read (models, buckets), five that
// add to a proposal, and one that asks the user a question. Nothing here
// writes to the database; change tools only update the workspace's draft.

import { z } from "zod"

import type {
  BucketModel,
  BucketsData,
} from "@/app/(dashboard)/apps/[id]/buckets-shared"
import { STRATEGY_OPTIONS } from "@/app/(dashboard)/apps/[id]/buckets-shared"
import type { ChatTool, JsonObject } from "@/lib/gateway/types"
import { MODEL_KINDS } from "@/lib/model-kinds"
import { priceTier } from "@/lib/pricing"
import { CAPABILITIES } from "@/lib/providers/catalog"

import {
  applyOp,
  describeOp,
  opContext,
  type AssistantOp,
  type BucketsState,
  type KindWarning,
  type OpContext,
} from "./ops"

export const MAX_LIST_ROWS = 60

export interface Workspace {
  models: BucketModel[]
  bySlug: Map<string, BucketModel>
  ctx: OpContext
  /** The board as it will look once the proposal so far is applied. */
  state: BucketsState
  /** The proposal so far, names normalized. */
  ops: AssistantOp[]
}

export function createWorkspace(
  data: BucketsData,
  state: BucketsState
): Workspace {
  return {
    models: data.models,
    bySlug: new Map(data.models.map((model) => [model.slug, model])),
    ctx: opContext(data.models, data.addable),
    state,
    ops: [],
  }
}

export interface ToolOutcome {
  ok: boolean
  /** JSON text sent back to the model. */
  content: string
  /** A short line for the chat: "Looked at 34 models". */
  step: string
  question?: { text: string; options: string[] }
  warnings: KindWarning[]
}

const STRATEGIES = STRATEGY_OPTIONS.map((option) => option.value)
const PROPOSE_ONLY = " This only adds to the proposal; the user applies it."

// Plain JSON schemas (no $schema or additionalProperties) so every provider
// adapter accepts them.
const str = (description: string): JsonObject => ({
  type: "string",
  description,
})
const slugs = (description: string): JsonObject => ({
  type: "array",
  items: { type: "string" },
  description,
})
const strategyProp: JsonObject = {
  type: "string",
  enum: STRATEGIES,
  description:
    "ordered: as listed; fastest: by recent time to first token; cheapest: by price; spread: rotate the first model.",
}
const hedgeProp: JsonObject = {
  type: ["integer", "null"],
  description:
    "Start the next model too if one hasn't answered after this many ms (250-60000), or null for no hedging.",
}
const tool = (
  name: string,
  description: string,
  properties: Record<string, JsonObject>,
  required: string[] = []
): ChatTool => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
})

export const TOOLS: ChatTool[] = [
  tool(
    "list_models",
    "Lists the models this app's owner can add to buckets, cheapest first, with price per million tokens, context size, capabilities, health and this month's requests.",
    {
      kind: {
        type: "string",
        enum: [...MODEL_KINDS],
        description: "Only models of this kind.",
      },
      price: {
        type: "string",
        enum: ["free", "paid", "any"],
        description: "free: both prices known to be $0.",
      },
      capabilities: {
        type: "array",
        items: { type: "string", enum: [...CAPABILITIES] },
        description: "Only models with all of these.",
      },
      query: str("Matches the model's name, slug or provider."),
    }
  ),
  tool(
    "list_buckets",
    "Lists this app's buckets as they will look once the proposal so far is applied, with each bucket's models in the order they're tried.",
    {}
  ),
  tool(
    "create_bucket",
    `Creates a bucket: a name the app's code calls like a model, with models tried in order.${PROPOSE_ONLY}`,
    {
      name: str("Short and lowercase, e.g. embed or cheap-chat."),
      models: slugs("Model slugs from list_models, in the order to try them."),
      strategy: strategyProp,
      hedge_after_ms: hedgeProp,
      make_default: {
        type: "boolean",
        description: "Answer requests that name no model.",
      },
    },
    ["name", "models"]
  ),
  tool(
    "delete_bucket",
    `Deletes a bucket.${PROPOSE_ONLY}`,
    { name: str("The bucket to delete.") },
    ["name"]
  ),
  tool(
    "add_models",
    `Adds models to a bucket.${PROPOSE_ONLY}`,
    {
      bucket: str("The bucket's name."),
      models: slugs("Model slugs from list_models."),
      position: {
        type: "integer",
        description: "1-based place to insert them; the end when left out.",
      },
    },
    ["bucket", "models"]
  ),
  tool(
    "remove_models",
    `Removes models from a bucket.${PROPOSE_ONLY}`,
    {
      bucket: str("The bucket's name."),
      models: slugs("Slugs of models in that bucket."),
    },
    ["bucket", "models"]
  ),
  tool(
    "update_bucket",
    `Changes a bucket: its name, order strategy, hedging, model order or whether it's the default.${PROPOSE_ONLY}`,
    {
      bucket: str("The bucket's current name."),
      new_name: str("A new name."),
      strategy: strategyProp,
      hedge_after_ms: hedgeProp,
      model_order: slugs("Every model now in the bucket, in the new order."),
      make_default: {
        type: "boolean",
        description:
          "true: make it the default; false: stop it being the default.",
      },
    },
    ["bucket"]
  ),
  tool(
    "ask_user",
    "Asks the user one question with 2 to 5 short answers they can click. Ends your turn; their answer comes as the next message.",
    {
      question: str("One short question."),
      options: {
        type: "array",
        items: { type: "string" },
        description: "2 to 5 short answers.",
      },
    },
    ["question", "options"]
  ),
]

const strategySchema = z.enum(
  STRATEGIES as [BucketsState["buckets"][number]["strategy"]]
)
const slugList = z.array(z.string().max(200)).max(50)
const bucketName = z.string().max(80)
const hedgeSchema = z.number().int().nullable()

const schemas = {
  list_models: z.object({
    kind: z.enum(MODEL_KINDS).optional(),
    price: z.enum(["free", "paid", "any"]).optional(),
    capabilities: z.array(z.enum(CAPABILITIES)).optional(),
    query: z.string().max(100).optional(),
  }),
  list_buckets: z.object({}),
  create_bucket: z.object({
    name: bucketName,
    models: slugList,
    strategy: strategySchema.optional(),
    hedge_after_ms: hedgeSchema.optional(),
    make_default: z.boolean().optional(),
  }),
  delete_bucket: z.object({ name: bucketName }),
  add_models: z.object({
    bucket: bucketName,
    models: slugList,
    position: z.number().int().min(1).optional(),
  }),
  remove_models: z.object({ bucket: bucketName, models: slugList }),
  update_bucket: z.object({
    bucket: bucketName,
    new_name: bucketName.optional(),
    strategy: strategySchema.optional(),
    hedge_after_ms: hedgeSchema.optional(),
    model_order: slugList.optional(),
    make_default: z.boolean().optional(),
  }),
  ask_user: z.object({
    question: z.string().min(1).max(300),
    options: z.array(z.string().min(1).max(80)).min(2).max(5),
  }),
} satisfies Record<string, z.ZodType>

type ToolName = keyof typeof schemas
type Args<T extends ToolName> = z.infer<(typeof schemas)[T]>

const FAILED_STEP = "Tried a change that didn't fit"

function failure(error: string, step = FAILED_STEP): ToolOutcome {
  return {
    ok: false,
    content: JSON.stringify({ ok: false, error }),
    step,
    warnings: [],
  }
}

function health(model: BucketModel): string {
  return model.status.kind === "ok"
    ? "ok"
    : `${model.status.kind}: ${model.status.label}`
}

/** Free first, then by input + output price, unknown prices last. */
function priceRank(model: BucketModel): [number, number] {
  const tier = priceTier(model.inputPrice, model.outputPrice)
  if (tier === "free") return [0, 0]
  if (tier === "unknown") return [2, 0]
  return [1, (model.inputPrice ?? 0) + (model.outputPrice ?? 0)]
}

function listModels(ws: Workspace, args: Args<"list_models">): ToolOutcome {
  const query = args.query?.trim().toLowerCase()
  const matches = ws.models
    .filter((model) => ws.ctx.addable.has(model.id))
    .filter((model) => !args.kind || model.kind === args.kind)
    .filter(
      (model) =>
        !args.price ||
        args.price === "any" ||
        priceTier(model.inputPrice, model.outputPrice) === args.price
    )
    .filter((model) =>
      (args.capabilities ?? []).every((c) => model.capabilities.includes(c))
    )
    .filter(
      (model) =>
        !query ||
        [model.name, model.slug, model.provider].some((text) =>
          text.toLowerCase().includes(query)
        )
    )
    .sort((a, b) => {
      const [tierA, priceA] = priceRank(a)
      const [tierB, priceB] = priceRank(b)
      return tierA - tierB || priceA - priceB || a.name.localeCompare(b.name)
    })
  const rows = matches.slice(0, MAX_LIST_ROWS).map((model) => ({
    slug: model.slug,
    name: model.name,
    provider: model.provider,
    kind: model.kind,
    price_per_mtok: {
      input: model.inputPrice,
      output: model.outputPrice,
      tier: priceTier(model.inputPrice, model.outputPrice),
    },
    context_window: model.contextWindow,
    capabilities: model.capabilities,
    health: health(model),
    requests_this_month: model.usage?.requests ?? 0,
  }))
  return {
    ok: true,
    content: JSON.stringify({
      total: matches.length,
      truncated: matches.length > rows.length,
      models: rows,
    }),
    step: `Looked at ${matches.length} models`,
    warnings: [],
  }
}

function listBuckets(ws: Workspace): ToolOutcome {
  const byId = new Map(ws.models.map((model) => [model.id, model]))
  return {
    ok: true,
    content: JSON.stringify({
      buckets: ws.state.buckets.map((bucket) => ({
        name: bucket.name,
        default: bucket.name === ws.state.defaultBucket,
        strategy: bucket.strategy,
        hedge_after_ms: bucket.hedgeAfterMs,
        models: bucket.modelIds.map((id) => {
          const model = byId.get(id)
          return model
            ? {
                slug: model.slug,
                name: model.name,
                kind: model.kind,
                price_tier: priceTier(model.inputPrice, model.outputPrice),
                health: health(model),
              }
            : { slug: null, name: "A model deleted from the gateway" }
        }),
      })),
      only_bucket_models: ws.state.onlyBucketModels,
    }),
    step: "Checked your buckets",
    warnings: [],
  }
}

class SlugError extends Error {}

function idsFor(ws: Workspace, slugs: string[]): string[] {
  return slugs.map((slug) => {
    const model = ws.bySlug.get(slug)
    if (!model)
      throw new SlugError(
        `There's no model with the slug "${slug}". Use slugs from list_models.`
      )
    return model.id
  })
}

function toOp(ws: Workspace, name: ToolName, args: unknown): AssistantOp {
  switch (name) {
    case "create_bucket": {
      const a = args as Args<"create_bucket">
      return {
        type: "create_bucket",
        name: a.name,
        modelIds: idsFor(ws, a.models),
        ...(a.strategy ? { strategy: a.strategy } : {}),
        ...(a.hedge_after_ms !== undefined
          ? { hedgeAfterMs: a.hedge_after_ms }
          : {}),
        ...(a.make_default !== undefined
          ? { makeDefault: a.make_default }
          : {}),
      }
    }
    case "delete_bucket":
      return {
        type: "delete_bucket",
        name: (args as Args<"delete_bucket">).name,
      }
    case "add_models": {
      const a = args as Args<"add_models">
      return {
        type: "add_models",
        bucket: a.bucket,
        modelIds: idsFor(ws, a.models),
        ...(a.position !== undefined ? { position: a.position } : {}),
      }
    }
    case "remove_models": {
      const a = args as Args<"remove_models">
      return {
        type: "remove_models",
        bucket: a.bucket,
        modelIds: idsFor(ws, a.models),
      }
    }
    default: {
      const a = args as Args<"update_bucket">
      return {
        type: "update_bucket",
        bucket: a.bucket,
        ...(a.new_name !== undefined ? { newName: a.new_name } : {}),
        ...(a.strategy ? { strategy: a.strategy } : {}),
        ...(a.hedge_after_ms !== undefined
          ? { hedgeAfterMs: a.hedge_after_ms }
          : {}),
        ...(a.model_order ? { modelOrder: idsFor(ws, a.model_order) } : {}),
        ...(a.make_default !== undefined
          ? { makeDefault: a.make_default }
          : {}),
      }
    }
  }
}

/** Runs one tool call. On success, change tools update ws.state and ws.ops. */
export function runTool(
  ws: Workspace,
  name: string,
  rawArgs: string
): ToolOutcome {
  if (!(name in schemas))
    return failure(`There's no tool named "${name}"`, "Tried an unknown tool")
  const toolName = name as ToolName

  let raw: unknown
  try {
    raw = rawArgs.trim() ? JSON.parse(rawArgs) : {}
  } catch {
    return failure("Those arguments aren't valid JSON")
  }
  const parsed = schemas[toolName].safeParse(raw)
  if (!parsed.success)
    return failure(
      `Bad arguments: ${parsed.error.issues[0]?.path.join(".") || "input"}: ${parsed.error.issues[0]?.message ?? "invalid"}`
    )

  if (toolName === "list_models")
    return listModels(ws, parsed.data as Args<"list_models">)
  if (toolName === "list_buckets") return listBuckets(ws)
  if (toolName === "ask_user") {
    const a = parsed.data as Args<"ask_user">
    return {
      ok: true,
      content: JSON.stringify({ ok: true, asked: true }),
      step: "Asked you a question",
      question: { text: a.question, options: a.options },
      warnings: [],
    }
  }

  let op: AssistantOp
  try {
    op = toOp(ws, toolName, parsed.data)
  } catch (error) {
    if (error instanceof SlugError) return failure(error.message)
    throw error
  }
  const result = applyOp(ws.state, op, ws.ctx)
  if (!result.ok) return failure(result.error)
  ws.state = result.state
  ws.ops.push(result.op)
  const nameOf = (id: string) => ws.ctx.models.get(id)?.name ?? id
  return {
    ok: true,
    content: JSON.stringify({
      ok: true,
      warnings: result.warnings.map((w) => `${w.title}. ${w.body}`),
    }),
    step: describeOp(result.op, nameOf),
    warnings: result.warnings,
  }
}
