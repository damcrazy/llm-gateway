import "server-only"

import { ENDPOINT_FOR_KIND } from "@/lib/model-kinds"

import { adapterFor } from "./adapters"
import { getSnapshot, invalidateGatewayConfig } from "./config"
import { toUpstreamError } from "./errors"
import { recordSuccess } from "./health"
import { usageFromChat } from "./usage"

export interface ModelTestResult {
  ok: boolean
  latencyMs: number
  status?: number
  output?: string
  error?: string
  inputTokens?: number
  outputTokens?: number
}

/** Sends a tiny prompt straight to one model (no fallback) and reports the result. */
export async function testModel(modelId: string): Promise<ModelTestResult> {
  invalidateGatewayConfig()
  const snapshot = await getSnapshot()
  const model = snapshot.models.get(modelId)
  if (!model) return { ok: false, latencyMs: 0, error: "Model not found" }

  if (model.kind !== "chat" && model.kind !== "embedding") {
    // Generating an image or audio costs money; test these from an app.
    return {
      ok: false,
      latencyMs: 0,
      error: `Testing ${model.kind} models here isn't supported; call ${ENDPOINT_FOR_KIND[model.kind]} with an app key instead.`,
    }
  }

  const adapter = adapterFor(model.provider.type)
  const signal = AbortSignal.timeout(60_000)
  const started = Date.now()
  try {
    if (model.kind === "embedding") {
      const response = await adapter.embeddings(
        { model: model.model_id, input: "ping" },
        { model, signal }
      )
      recordSuccess(model, snapshot)
      const dims = Array.isArray(response.data?.[0]?.embedding)
        ? response.data[0].embedding.length
        : 0
      return {
        ok: true,
        latencyMs: Date.now() - started,
        output: `${dims}-dimension embedding`,
        inputTokens: response.usage?.prompt_tokens,
      }
    }

    const result = await adapter.chat(
      {
        model: model.model_id,
        messages: [
          { role: "user", content: "Reply with exactly one word: pong" },
        ],
        stream: false,
      },
      { model, signal }
    )
    if (result.type !== "json") throw new Error("Unexpected streaming response")
    recordSuccess(model, snapshot)
    const message = result.completion.choices[0]?.message
    const usage = usageFromChat(result.completion.usage)
    return {
      ok: true,
      latencyMs: Date.now() - started,
      output:
        (typeof message?.content === "string" && message.content.trim()) ||
        (message?.tool_calls?.length ? "[tool call]" : "(empty response)"),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    }
  } catch (error) {
    const upstream = toUpstreamError(error)
    return {
      ok: false,
      latencyMs: Date.now() - started,
      status: upstream.status ?? undefined,
      error: upstream.message,
    }
  }
}
