import "server-only"

import type { ProviderRuntime } from "../config"
import { fetchFor } from "../provider-fetch"
import {
  UpstreamError,
  extractErrorMessage,
  upstreamErrorFromResponse,
} from "../errors"
import { parseSse } from "../sse"
import type {
  ChatChunk,
  ChatCompletion,
  ChatMessage,
  ChatRequest,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from "../types"
import type { AdapterContext, ChatResult, ProviderAdapter } from "./types"

// Pass-through adapter for OpenAI-compatible APIs (OpenAI, Groq, OpenRouter,
// DeepSeek, Mistral, Together, Ollama, vLLM, …) and Azure OpenAI. The request
// body is forwarded as-is apart from the model id, so provider-specific
// parameters keep working.

function endpoint(
  provider: ProviderRuntime,
  path: "chat/completions" | "embeddings",
  modelId: string
) {
  const base = (provider.config.baseUrl ?? "").trim().replace(/\/+$/, "")
  if (!base)
    throw new UpstreamError(
      `Provider '${provider.name}' has no base URL`,
      null,
      { kind: "config" }
    )

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(provider.config.headers ?? {}),
  }
  const apiKey = provider.credentials.apiKey

  if (provider.type === "azure_openai") {
    if (!apiKey)
      throw new UpstreamError(
        `Provider '${provider.name}' has no API key`,
        null,
        { kind: "config" }
      )
    headers["api-key"] = apiKey
    const root = base.replace(/\/openai(\/v1)?$/, "")
    const apiVersion = provider.config.apiVersion?.trim()
    const url = apiVersion
      ? `${root}/openai/deployments/${encodeURIComponent(modelId)}/${path}?api-version=${encodeURIComponent(apiVersion)}`
      : `${root}/openai/v1/${path}`
    return { url, headers }
  }

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (provider.config.preset === "openrouter") {
    headers["X-Title"] ??= "LLM Gateway"
  }
  return { url: `${base}/${path}`, headers }
}

/** cache_control is an Anthropic/OpenRouter extension; strict APIs reject it. */
function withoutCacheControl<T extends object>(value: T): T {
  if (!("cache_control" in value)) return value
  const copy = { ...value } as T & { cache_control?: unknown }
  delete copy.cache_control
  return copy
}

function stripCacheControl(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    Array.isArray(message.content)
      ? {
          ...message,
          content: message.content.map((part) => withoutCacheControl(part)),
        }
      : message
  )
}

function buildBody(request: ChatRequest, ctx: AdapterContext): ChatRequest {
  const body: ChatRequest = { ...request, model: ctx.model.model_id }
  if (ctx.model.provider.config.preset !== "openrouter") {
    body.messages = stripCacheControl(body.messages)
    if (body.tools)
      body.tools = body.tools.map((tool) => withoutCacheControl(tool))
  }
  if (body.stream) {
    body.stream_options = {
      ...(body.stream_options ?? {}),
      include_usage: true,
    }
  } else {
    delete body.stream_options
  }
  return body
}

async function* streamChunks(response: Response): AsyncGenerator<ChatChunk> {
  if (!response.body)
    throw new UpstreamError("Upstream returned an empty stream", null, {
      kind: "stream",
    })
  for await (const event of parseSse(response.body)) {
    if (event.data === "[DONE]") return
    let parsed: ChatChunk & { error?: unknown }
    try {
      parsed = JSON.parse(event.data)
    } catch {
      continue
    }
    if (parsed.error && !parsed.choices?.length) {
      const error = parsed.error as { message?: string; code?: number | string }
      const status = typeof error.code === "number" ? error.code : 502
      throw new UpstreamError(
        error.message ??
          extractErrorMessage(event.data) ??
          "Upstream stream error",
        status,
        {
          kind: "stream",
        }
      )
    }
    yield parsed
  }
}

export const openAIAdapter: ProviderAdapter = {
  async chat(request, ctx): Promise<ChatResult> {
    const { url, headers } = endpoint(
      ctx.model.provider,
      "chat/completions",
      ctx.model.model_id
    )
    const response = await fetchFor(ctx.model.provider)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(request, ctx)),
      signal: ctx.signal,
    })
    if (!response.ok) throw await upstreamErrorFromResponse(response)

    if (!request.stream) {
      const completion = (await response.json()) as ChatCompletion & {
        error?: unknown
      }
      if (completion.error || !Array.isArray(completion.choices)) {
        throw new UpstreamError(
          extractErrorMessage(JSON.stringify(completion)) ??
            "Upstream returned an invalid response",
          502
        )
      }
      return { type: "json", completion }
    }
    return { type: "stream", chunks: streamChunks(response) }
  },

  async embeddings(
    request: EmbeddingsRequest,
    ctx
  ): Promise<EmbeddingsResponse> {
    const { url, headers } = endpoint(
      ctx.model.provider,
      "embeddings",
      ctx.model.model_id
    )
    const response = await fetchFor(ctx.model.provider)(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...request, model: ctx.model.model_id }),
      signal: ctx.signal,
    })
    if (!response.ok) throw await upstreamErrorFromResponse(response)
    return (await response.json()) as EmbeddingsResponse
  },
}

/** GET {base}/models for discovery. Returns the raw `data` array. */
export async function listOpenAIModels(
  provider: ProviderRuntime
): Promise<Record<string, unknown>[]> {
  const { url, headers } = endpoint(provider, "chat/completions", "")
  const response = await fetchFor(provider)(
    url.replace(/\/chat\/completions(\?.*)?$/, "/models"),
    {
      headers,
      signal: AbortSignal.timeout(20_000),
    }
  )
  if (!response.ok) throw await upstreamErrorFromResponse(response)
  const body = (await response.json()) as { data?: unknown; models?: unknown }
  const list = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : Array.isArray(body)
        ? body
        : []
  return list as Record<string, unknown>[]
}
