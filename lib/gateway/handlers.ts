import "server-only"

import type { GatewayApp } from "@/lib/db/types"

import type { CacheOptions } from "./cache"

import { after } from "next/server"

import { authenticateRequest, enforceLimits, recordTokens } from "./auth"
import type { ModelRuntime } from "./config"
import { getSnapshot } from "./config"
import { ClientAbortError, GatewayError, toUpstreamError } from "./errors"
import {
  executeChat,
  executeEmbeddings,
  finishJson,
  observeChat,
} from "./execute"
import { checkAfterRequest } from "./alerts"
import { exportTrace } from "./export"
import { RequestRecorder } from "./recorder"
import { captureRequestContext } from "./tags"
import {
  chatToResponses,
  chunksToResponsesEvents,
  responsesToChat,
  type ResponsesRequest,
} from "./translate/responses"
import { listAvailableModels } from "./router"
import { SSE_HEADERS, encodeSse } from "./sse"
import {
  anthropicToChat,
  chatToAnthropic,
  chunksToAnthropicEvents,
  type AnthropicRequest,
} from "./translate/anthropic"
import type { ChatChunk, ChatRequest, EmbeddingsRequest } from "./types"
import { estimateRequestTokens } from "./usage"

type Surface = "openai" | "anthropic"

const MAX_BODY_BYTES = 32 * 1024 * 1024

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > MAX_BODY_BYTES) {
    throw new GatewayError(
      413,
      "Request body is too large.",
      "request_too_large"
    )
  }
  try {
    return (await request.json()) as T
  } catch {
    throw new GatewayError(
      400,
      "Request body must be valid JSON.",
      "invalid_json"
    )
  }
}

/**
 * The app's response cache for this request. Clients can skip reading it
 * with Cache-Control: no-cache, or skip it entirely with no-store.
 */
function cacheFor(app: GatewayApp, request: Request): CacheOptions | undefined {
  if (!app.cache_ttl_seconds) return undefined
  const control = (request.headers.get("cache-control") ?? "").toLowerCase()
  const noStore = control.includes("no-store")
  return {
    appId: app.id,
    ttlSeconds: app.cache_ttl_seconds,
    read: !noStore && !control.includes("no-cache"),
    write: !noStore,
  }
}

function gatewayHeaders(
  recorder: RequestRecorder,
  model?: ModelRuntime
): Record<string, string> {
  return {
    "x-gateway-request-id": recorder.id,
    ...(recorder.cacheStatus
      ? { "x-gateway-cache": recorder.cacheStatus }
      : {}),
    ...(model
      ? {
          "x-gateway-model": model.slug,
          "x-gateway-provider": model.provider.slug,
          "x-gateway-attempts": String(recorder.attempts.length),
        }
      : {}),
  }
}

const ANTHROPIC_ERROR_TYPES: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  503: "overloaded_error",
}

function errorBody(error: GatewayError, surface: Surface) {
  if (surface === "anthropic") {
    return {
      type: "error",
      error: {
        type: ANTHROPIC_ERROR_TYPES[error.status] ?? "api_error",
        message: error.message,
      },
    }
  }
  return {
    error: {
      message: error.message,
      type: error.type,
      code: error.code,
      param: null,
    },
  }
}

function errorResponse(
  error: unknown,
  recorder: RequestRecorder,
  surface: Surface
): Response {
  if (error instanceof ClientAbortError) {
    recorder.fail(499, "Client closed the request")
    return new Response(null, { status: 499 })
  }
  const gatewayError =
    error instanceof GatewayError
      ? error
      : new GatewayError(500, "Internal gateway error.", "internal_error")
  if (!(error instanceof GatewayError))
    console.error("[gateway] unhandled error:", error)
  recorder.fail(gatewayError.status, gatewayError.message)
  return Response.json(errorBody(gatewayError, surface), {
    status: gatewayError.status,
    headers: {
      ...gatewayError.headers,
      ...gatewayHeaders(recorder, recorder.served),
    },
  })
}

/** Pulls from an async generator into an SSE byte stream; cancellation propagates upstream. */
function sseStream<T>(
  source: AsyncGenerator<T>,
  encode: (item: T) => Uint8Array,
  options: { onError: (error: unknown) => Uint8Array; end?: Uint8Array }
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await source.next()
        if (done) {
          if (options.end) controller.enqueue(options.end)
          controller.close()
          return
        }
        controller.enqueue(encode(value))
      } catch (error) {
        controller.enqueue(options.onError(error))
        controller.close()
      }
    },
    async cancel() {
      await source.return(undefined)
    },
  })
}

function streamErrorMessage(error: unknown) {
  return error instanceof GatewayError
    ? error.message
    : toUpstreamError(error).message
}

async function begin(request: Request, recorder: RequestRecorder) {
  const auth = await recorder.timed("auth", () => authenticateRequest(request))
  recorder.enableLogging({
    appId: auth.app.id,
    apiKeyId: auth.keyId,
    ownerEmail: auth.owner.email,
    logPayloads: auth.app.log_payloads,
    scrubPayloads: auth.app.pii_mode !== "off",
  })
  after(async () => {
    await recorder.persist()
    // Provider tokens count toward per-minute token limits (cache hits don't).
    if (recorder.usage && recorder.cacheStatus !== "HIT")
      recordTokens(
        auth,
        recorder.usage.inputTokens + recorder.usage.outputTokens
      )
    await Promise.all([
      checkAfterRequest(recorder, auth),
      exportTrace(recorder, auth),
    ])
  })
  await recorder.timed("limits", () => enforceLimits(auth))
  return auth
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions (OpenAI)
// ---------------------------------------------------------------------------

export async function handleChatCompletions(
  request: Request
): Promise<Response> {
  const recorder = new RequestRecorder("chat.completions", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<ChatRequest>(request)
    if (!body || !Array.isArray(body.messages) || !body.messages.length) {
      throw new GatewayError(
        400,
        "`messages` must be a non-empty array.",
        "invalid_request"
      )
    }
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = body

    const execution = await executeChat({
      request: body,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      signal: request.signal,
      recorder,
    })
    const headers = gatewayHeaders(recorder, execution.model)

    if (execution.type === "json") {
      finishJson(recorder, execution.completion, body)
      return Response.json(execution.completion, { headers })
    }

    const { chunks } = execution
    const includeUsage = body.stream_options?.include_usage === true
    async function* output(): AsyncGenerator<ChatChunk> {
      for await (const chunk of observeChat(chunks, recorder, body)) {
        if (includeUsage) {
          yield chunk
        } else if (chunk.choices?.length) {
          // The gateway always asks upstream for usage; hide it unless the client asked too.
          if (chunk.usage) {
            const copy = { ...chunk }
            delete copy.usage
            yield copy
          } else yield chunk
        }
      }
    }

    return new Response(
      sseStream(output(), (chunk) => encodeSse(chunk), {
        end: encodeSse("[DONE]"),
        onError: (error) =>
          encodeSse({
            error: {
              message: streamErrorMessage(error),
              type: "api_error",
              code: "stream_error",
            },
          }),
      }),
      { headers: { ...SSE_HEADERS, ...headers } }
    )
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

// ---------------------------------------------------------------------------
// POST /v1/messages (Anthropic)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /v1/responses (OpenAI Responses API, stateless)
// ---------------------------------------------------------------------------

export async function handleResponses(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("responses", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<ResponsesRequest>(request)
    if (
      !body ||
      (typeof body.input !== "string" && !Array.isArray(body.input))
    ) {
      throw new GatewayError(
        400,
        "`input` must be a string or an array of input items.",
        "invalid_request"
      )
    }
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = body

    const chatRequest = responsesToChat(body)
    const execution = await executeChat({
      request: chatRequest,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      signal: request.signal,
      recorder,
    })
    const headers = gatewayHeaders(recorder, execution.model)

    if (execution.type === "json") {
      finishJson(recorder, execution.completion, chatRequest)
      return Response.json(
        chatToResponses(execution.completion, body, recorder.usage),
        { headers }
      )
    }

    const events = chunksToResponsesEvents(
      observeChat(execution.chunks, recorder, chatRequest),
      body,
      () => recorder.usage
    )
    return new Response(
      sseStream(events, (event) => encodeSse(event, event.type), {
        onError: (error) =>
          encodeSse(
            {
              type: "error",
              code: "stream_error",
              message: streamErrorMessage(error),
            },
            "error"
          ),
      }),
      { headers: { ...SSE_HEADERS, ...headers } }
    )
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

export async function handleMessages(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("messages", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<AnthropicRequest>(request)
    if (!body || !Array.isArray(body.messages) || !body.messages.length) {
      throw new GatewayError(
        400,
        "`messages` must be a non-empty array.",
        "invalid_request"
      )
    }
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = body

    const chatRequest = anthropicToChat(body)
    const execution = await executeChat({
      request: chatRequest,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      signal: request.signal,
      recorder,
    })
    const headers = gatewayHeaders(recorder, execution.model)

    if (execution.type === "json") {
      finishJson(recorder, execution.completion, chatRequest)
      return Response.json(
        chatToAnthropic(execution.completion, body.model, recorder.usage),
        { headers }
      )
    }

    const events = chunksToAnthropicEvents(
      observeChat(execution.chunks, recorder, chatRequest),
      body.model,
      () => recorder.usage
    )
    return new Response(
      sseStream(events, (event) => encodeSse(event.data, event.event), {
        onError: (error) =>
          encodeSse(
            {
              type: "error",
              error: { type: "api_error", message: streamErrorMessage(error) },
            },
            "error"
          ),
      }),
      { headers: { ...SSE_HEADERS, ...headers } }
    )
  } catch (error) {
    return errorResponse(error, recorder, "anthropic")
  }
}

/** POST /v1/messages/count_tokens — an estimate; good enough for context budgeting. */
export async function handleCountTokens(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("count_tokens", request)
  try {
    await authenticateRequest(request)
    const body = await readJson<AnthropicRequest>(request)
    const chatRequest = anthropicToChat({
      ...body,
      messages: body.messages ?? [],
    })
    return Response.json({ input_tokens: estimateRequestTokens(chatRequest) })
  } catch (error) {
    return errorResponse(error, recorder, "anthropic")
  }
}

// ---------------------------------------------------------------------------
// POST /v1/embeddings
// ---------------------------------------------------------------------------

export async function handleEmbeddings(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("embeddings", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<EmbeddingsRequest>(request)
    if (
      body?.input == null ||
      (Array.isArray(body.input) && !body.input.length)
    ) {
      throw new GatewayError(400, "`input` is required.", "invalid_request")
    }
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads)
      recorder.requestBody = { ...body, input: "[omitted]" }
    const { response, model } = await executeEmbeddings({
      request: body,
      app: auth.app,
      policy: auth.owner.policy,
      signal: request.signal,
      recorder,
    })
    return Response.json(response, { headers: gatewayHeaders(recorder, model) })
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

// ---------------------------------------------------------------------------
// GET /v1/models (OpenAI or Anthropic shape)
// ---------------------------------------------------------------------------

export async function handleListModels(request: Request): Promise<Response> {
  const anthropic = request.headers.has("anthropic-version")
  const recorder = new RequestRecorder("models", request)
  try {
    const auth = await authenticateRequest(request)
    const models = listAvailableModels(
      await getSnapshot(),
      auth.app,
      auth.owner.policy
    )
    if (anthropic) {
      const data = models
        .filter((model) => model.kind === "chat")
        .map((model) => ({
          type: "model",
          id: model.id,
          display_name: model.displayName,
          created_at: model.created,
        }))
      return Response.json({
        data,
        has_more: false,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
      })
    }
    return Response.json({
      object: "list",
      data: models.map((model) => ({
        id: model.id,
        object: "model",
        created: Math.floor(new Date(model.created).getTime() / 1000),
        owned_by: model.ownedBy,
      })),
    })
  } catch (error) {
    return errorResponse(error, recorder, anthropic ? "anthropic" : "openai")
  }
}
