import "server-only"

import { priceTier } from "@/lib/pricing"

import { enforceLimits, type AuthContext } from "./auth"
import { GatewayError } from "./errors"
import { executeChat, finishJson } from "./execute"
import { privateOwnerFor } from "./playground"
import { RequestRecorder } from "./recorder"
import type { ChatMessage, ChatRequest } from "./types"

/**
 * One non-streamed chat request from the dashboard, run as an app: its rate
 * limits and budgets apply, and it's logged under it as `endpoint`. Unlike an
 * API key, it isn't held to "only bucket models": the person asking is the
 * app's owner (or an admin) in the dashboard. Throws GatewayError.
 */
export async function runChatAsApp({
  request,
  context,
  runnerEmail,
  endpoint,
  signal,
}: {
  request: ChatRequest
  context: AuthContext
  runnerEmail: string
  endpoint: string
  signal: AbortSignal
}): Promise<{
  message: ChatMessage
  modelSlug: string
  inputTokens: number
  outputTokens: number
  /** undefined when the serving model's price is unknown */
  costUsd?: number
}> {
  const recorder = new RequestRecorder(endpoint)
  recorder.enableLogging({
    appId: context.app.id,
    apiKeyId: null,
    ownerEmail: context.owner.email,
    logPayloads: context.app.log_payloads,
  })
  try {
    if (!context.app.enabled) {
      throw new GatewayError(
        403,
        `App '${context.app.name}' is disabled.`,
        "app_disabled",
        "permission_error"
      )
    }
    await recorder.timed("limits", () => enforceLimits(context))
    const fullRequest: ChatRequest = { ...request, stream: false }
    const execution = await executeChat({
      request: fullRequest,
      app: { ...context.app, only_bucket_models: false },
      policy: context.owner.policy,
      privateOwner: privateOwnerFor(context, runnerEmail),
      signal,
      recorder,
    })
    if (execution.type !== "json")
      throw new GatewayError(500, "Unexpected stream", "internal_error")
    finishJson(recorder, execution.completion, fullRequest)
    const unknownPrice =
      priceTier(
        execution.model.input_price_per_mtok,
        execution.model.output_price_per_mtok
      ) === "unknown"
    return {
      message: execution.completion.choices[0]?.message ?? {
        role: "assistant",
        content: "",
      },
      modelSlug: execution.model.slug,
      inputTokens: recorder.usage?.inputTokens ?? 0,
      outputTokens: recorder.usage?.outputTokens ?? 0,
      costUsd: unknownPrice ? undefined : recorder.costUsd,
    }
  } catch (error) {
    recorder.fail(
      error instanceof GatewayError ? error.status : 500,
      error instanceof Error ? error.message : "Internal gateway error"
    )
    throw error
  } finally {
    await recorder.persist()
  }
}
