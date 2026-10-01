import "server-only"

import type { AttemptLogEntry } from "@/lib/db/types"
import { priceTier } from "@/lib/pricing"

import { ClientAbortError, GatewayError } from "./errors"
import { executeChat, finishJson } from "./execute"
import { RequestRecorder } from "./recorder"
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
  /** The admin running it; their usage is attributed to them. */
  ownerEmail?: string
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
  recorder.enableLogging({
    appId: null,
    apiKeyId: null,
    ownerEmail: input.ownerEmail ?? null,
    logPayloads: false,
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
    const execution = await executeChat({
      request,
      app: null,
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
