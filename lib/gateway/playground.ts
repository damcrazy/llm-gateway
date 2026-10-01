import "server-only"

import type { AttemptLogEntry, RouteStrategy } from "@/lib/db/types"
import { priceTier } from "@/lib/pricing"

import { enforceLimits, loadAppContext, type AuthContext } from "./auth"
import { getSnapshot } from "./config"
import { ClientAbortError, GatewayError } from "./errors"
import { executeChat, finishJson } from "./execute"
import { RequestRecorder } from "./recorder"
import { listAvailableModels } from "./router"
import type { ChatRequest } from "./types"

export interface PlaygroundMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface PlaygroundRequest {
  /** Route name or model slug, exactly as an app would send it. */
  model: string
  messages: PlaygroundMessage[]
  temperature?: number
  maxTokens?: number
  /**
   * Run as this app: its allowed models, rate limit and budget apply, plus
   * its owner's model access and budget, and usage is logged under it.
   */
  appId?: string | null
  /** Without an app: the admin running it; usage is attributed to them. */
  ownerEmail?: string
}

export interface PlaygroundOptions {
  routes: {
    name: string
    description: string | null
    strategy: RouteStrategy
  }[]
  modelGroups: {
    provider: string
    models: { slug: string; displayName: string | null }[]
  }[]
}

/** Chat routes and models the app (or, with no app, an admin) can call. */
export async function playgroundOptions(
  context: AuthContext | null
): Promise<PlaygroundOptions> {
  const snapshot = await getSnapshot()
  const available = listAvailableModels(
    snapshot,
    context?.app ?? null,
    context?.owner.policy
  ).filter((entry) => entry.kind === "chat")

  const routes: PlaygroundOptions["routes"] = []
  const groups = new Map<string, PlaygroundOptions["modelGroups"][number]>()
  for (const entry of available) {
    const route = snapshot.routes.get(entry.id)
    if (route) {
      routes.push({
        name: route.name,
        description: route.description,
        strategy: route.strategy,
      })
      continue
    }
    const model = snapshot.modelsBySlug.get(entry.id)
    if (!model) continue
    const group = groups.get(model.provider.id) ?? {
      provider: model.provider.name,
      models: [],
    }
    group.models.push({ slug: model.slug, displayName: model.display_name })
    groups.set(model.provider.id, group)
  }
  return {
    routes,
    modelGroups: [...groups.values()].sort((a, b) =>
      a.provider.localeCompare(b.provider)
    ),
  }
}

export interface PlaygroundResult {
  ok: boolean
  content?: string
  reasoning?: string
  error?: string
  /** Slug of the model that answered. */
  modelSlug?: string
  provider?: string
  attempts: AttemptLogEntry[]
  inputTokens?: number
  outputTokens?: number
  /** undefined when the serving model's price is unknown */
  costUsd?: number
  latencyMs: number
}

/** Runs a chat request through the full gateway pipeline (routing, fallback, logging). */
export async function runPlayground(
  input: PlaygroundRequest
): Promise<PlaygroundResult> {
  const recorder = new RequestRecorder("playground")
  let context: AuthContext | null = null
  if (input.appId) {
    context = await loadAppContext(input.appId)
    if (!context) {
      return {
        ok: false,
        error: "That app no longer exists",
        attempts: [],
        latencyMs: 0,
      }
    }
  }
  recorder.enableLogging({
    appId: context?.app.id ?? null,
    apiKeyId: null,
    ownerEmail: context?.owner.email ?? input.ownerEmail ?? null,
    logPayloads: context?.app.log_payloads ?? false,
  })

  const request: ChatRequest = {
    model: input.model,
    messages: input.messages
      .filter((message) => message.content.trim() !== "")
      .map((message) => ({ role: message.role, content: message.content })),
    stream: false,
    ...(input.temperature != null ? { temperature: input.temperature } : {}),
    ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
  }

  try {
    if (context) {
      if (!context.app.enabled) {
        throw new GatewayError(
          403,
          `App '${context.app.name}' is disabled.`,
          "app_disabled",
          "permission_error"
        )
      }
      await enforceLimits(context)
    }
    const execution = await executeChat({
      request,
      app: context?.app ?? null,
      policy: context?.owner.policy,
      signal: AbortSignal.timeout(300_000),
      recorder,
    })
    if (execution.type !== "json")
      throw new GatewayError(500, "Unexpected stream", "internal_error")
    finishJson(recorder, execution.completion, request)
    const message = execution.completion.choices[0]?.message
    const toolCalls = message?.tool_calls?.length
      ? `\n\n[tool calls: ${message.tool_calls.map((c) => c.function.name).join(", ")}]`
      : ""
    return {
      ok: true,
      content: `${typeof message?.content === "string" ? message.content : ""}${toolCalls}`,
      reasoning: message?.reasoning_content || undefined,
      modelSlug: execution.model.slug,
      provider: execution.model.provider.name,
      attempts: recorder.attempts,
      inputTokens: recorder.usage?.inputTokens,
      outputTokens: recorder.usage?.outputTokens,
      costUsd:
        priceTier(
          execution.model.input_price_per_mtok,
          execution.model.output_price_per_mtok
        ) === "unknown"
          ? undefined
          : recorder.costUsd,
      latencyMs: recorder.latencyMs,
    }
  } catch (error) {
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof ClientAbortError
          ? "Request timed out"
          : "Internal gateway error"
    if (!(error instanceof GatewayError))
      console.error("[gateway] playground error:", error)
    recorder.fail(error instanceof GatewayError ? error.status : 500, message)
    return {
      ok: false,
      error: message,
      attempts: recorder.attempts,
      latencyMs: recorder.latencyMs,
    }
  } finally {
    await recorder.persist()
  }
}
