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
  executeMedia,
  finishJson,
  observeChat,
  protectTexts,
} from "./execute"
import { checkAfterRequest } from "./alerts"
import { exportTrace } from "./export"
import { parsePromptRef } from "./prompts"
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
import type { ChatChunk, ChatRequest, EmbeddingsRequest, Usage } from "./types"
import { estimateRequestTokens, estimateTokens } from "./usage"

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
    const raw = await readJson<ChatRequest>(request)
    // `prompt` (a library prompt) is the gateway's; providers never see it.
    const { prompt: promptField, ...body } = raw ?? ({} as ChatRequest)
    const prompt = parsePromptRef(promptField)
    if (
      !raw ||
      (body.messages !== undefined && !Array.isArray(body.messages)) ||
      (!prompt && !body.messages?.length)
    ) {
      throw new GatewayError(
        400,
        "`messages` must be a non-empty array.",
        "invalid_request"
      )
    }
    body.messages ??= []
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = raw

    const execution = await executeChat({
      request: body,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      prompt,
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
    const prompt = parsePromptRef(body?.prompt)
    if (
      !body ||
      (body.input !== undefined &&
        typeof body.input !== "string" &&
        !Array.isArray(body.input)) ||
      (!prompt && body.input === undefined)
    ) {
      throw new GatewayError(
        400,
        "`input` must be a string or an array of input items.",
        "invalid_request"
      )
    }
    body.input ??= []
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = body

    const chatRequest = responsesToChat(body, { allowEmpty: Boolean(prompt) })
    const execution = await executeChat({
      request: chatRequest,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      prompt,
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
    const prompt = parsePromptRef((body as { prompt?: unknown } | null)?.prompt)
    if (
      !body ||
      (body.messages !== undefined && !Array.isArray(body.messages)) ||
      (!prompt && !body.messages?.length)
    ) {
      throw new GatewayError(
        400,
        "`messages` must be a non-empty array.",
        "invalid_request"
      )
    }
    body.messages ??= []
    captureRequestContext(recorder, request, body)
    if (recorder.logPayloads) recorder.requestBody = body

    const chatRequest = anthropicToChat(body)
    const execution = await executeChat({
      request: chatRequest,
      app: auth.app,
      policy: auth.owner.policy,
      cache: cacheFor(auth.app, request),
      prompt,
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
// Images, speech, transcription and rerank (OpenAI-compatible providers)
// ---------------------------------------------------------------------------

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

function requireModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : ""
  if (!model)
    throw new GatewayError(400, "`model` is required.", "invalid_request")
  return model
}

/** Token usage some media APIs report (gpt-image, gpt-4o-transcribe, rerankers). */
function mediaUsage(raw: unknown): Usage | undefined {
  const usage = raw as
    | {
        input_tokens?: number
        output_tokens?: number
        prompt_tokens?: number
        total_tokens?: number
      }
    | undefined
  if (!usage || typeof usage !== "object") return undefined
  const input = usage.input_tokens ?? usage.prompt_tokens ?? usage.total_tokens
  const output = usage.output_tokens ?? 0
  if (typeof input !== "number") return undefined
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens: 0,
    reasoningTokens: 0,
    estimated: false,
  }
}

/** Priced per unit when the model has a unit price; else by tokens, if any. */
function chargeUnits(
  recorder: RequestRecorder,
  model: ModelRuntime,
  units: number | null
) {
  if (model.unit_price_usd != null && units != null)
    recorder.unitCostUsd = Number(model.unit_price_usd) * units
}

export async function handleImages(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("images", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<Record<string, unknown>>(request)
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim())
      throw new GatewayError(400, "`prompt` is required.", "invalid_request")
    captureRequestContext(recorder, request, body)
    const [prompt] = protectTexts(auth.app, [body.prompt], recorder)
    if (recorder.logPayloads) recorder.requestBody = { ...body, prompt }
    const { response, model } = await executeMedia({
      kind: "image",
      path: "images/generations",
      model: requireModel(body.model),
      app: auth.app,
      policy: auth.owner.policy,
      body: (modelId) => JSON.stringify({ ...body, prompt, model: modelId }),
      signal: request.signal,
      recorder,
    })
    const result = (await response.json()) as {
      created?: number
      data?: unknown[]
      usage?: unknown
    }
    const count = Array.isArray(result.data)
      ? result.data.length
      : Number(body.n ?? 1)
    recorder.usage = mediaUsage(result.usage)
    chargeUnits(recorder, model, count)
    // Images (often base64) aren't stored; just how many there were.
    if (recorder.logPayloads)
      recorder.responseBody = { created: result.created, images: count }
    recorder.finish()
    return Response.json(result, { headers: gatewayHeaders(recorder, model) })
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

export async function handleSpeech(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("speech", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<Record<string, unknown>>(request)
    if (!body || typeof body.input !== "string" || !body.input.trim())
      throw new GatewayError(400, "`input` is required.", "invalid_request")
    captureRequestContext(recorder, request, body)
    const [input] = protectTexts(auth.app, [body.input], recorder)
    if (recorder.logPayloads) recorder.requestBody = { ...body, input }
    const { response, model } = await executeMedia({
      kind: "speech",
      path: "audio/speech",
      model: requireModel(body.model),
      app: auth.app,
      policy: auth.owner.policy,
      body: (modelId) => JSON.stringify({ ...body, input, model: modelId }),
      signal: request.signal,
      recorder,
    })
    recorder.usage = {
      inputTokens: estimateTokens(input),
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      estimated: true,
    }
    chargeUnits(recorder, model, input.length / 1000)
    // The audio streams straight through once the provider starts sending.
    recorder.finish()
    return new Response(response.body, {
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/octet-stream",
        ...gatewayHeaders(recorder, model),
      },
    })
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

export async function handleTranscription(
  request: Request,
  path: "audio/transcriptions" | "audio/translations"
): Promise<Response> {
  const recorder = new RequestRecorder(
    path === "audio/translations" ? "translations" : "transcriptions",
    request
  )
  try {
    const auth = await begin(request, recorder)
    if (!request.headers.get("content-type")?.includes("multipart/form-data"))
      throw new GatewayError(
        400,
        "Send the audio as multipart/form-data with `file` and `model`.",
        "invalid_request"
      )
    const length = Number(request.headers.get("content-length") ?? 0)
    if (length > MAX_AUDIO_BYTES)
      throw new GatewayError(
        413,
        "Audio files can be up to 25 MB.",
        "request_too_large"
      )
    const form = await request.formData().catch(() => {
      throw new GatewayError(
        400,
        "Couldn't read the form data.",
        "invalid_request"
      )
    })
    const file = form.get("file")
    if (!(file instanceof File))
      throw new GatewayError(400, "`file` is required.", "invalid_request")
    if (file.size > MAX_AUDIO_BYTES)
      throw new GatewayError(
        413,
        "Audio files can be up to 25 MB.",
        "request_too_large"
      )
    const fields: Record<string, string> = {}
    for (const [key, value] of form) {
      if (typeof value === "string") fields[key] = value.slice(0, 2000)
    }
    captureRequestContext(recorder, request, fields)
    if (recorder.logPayloads)
      recorder.requestBody = {
        ...fields,
        file: { name: file.name, type: file.type, bytes: file.size },
      }
    const { response, model } = await executeMedia({
      kind: "transcription",
      path,
      model: requireModel(fields.model),
      app: auth.app,
      policy: auth.owner.policy,
      body: (modelId) => {
        const upstream = new FormData()
        for (const [key, value] of form) {
          if (key !== "model") upstream.append(key, value)
        }
        upstream.append("model", modelId)
        return upstream
      },
      signal: request.signal,
      recorder,
    })
    const contentType =
      response.headers.get("content-type") ?? "application/json"
    const text = await response.text()
    let minutes: number | null = null
    if (contentType.includes("json")) {
      try {
        const result = JSON.parse(text) as {
          duration?: number
          usage?: { seconds?: number }
        }
        recorder.usage = mediaUsage(result.usage)
        const seconds = result.usage?.seconds ?? result.duration
        if (typeof seconds === "number") minutes = seconds / 60
      } catch {
        // Not JSON after all; pass it through.
      }
    }
    chargeUnits(recorder, model, minutes)
    if (recorder.logPayloads) recorder.responseBody = text
    recorder.finish()
    return new Response(text, {
      headers: {
        "content-type": contentType,
        ...gatewayHeaders(recorder, model),
      },
    })
  } catch (error) {
    return errorResponse(error, recorder, "openai")
  }
}

export async function handleRerank(request: Request): Promise<Response> {
  const recorder = new RequestRecorder("rerank", request)
  try {
    const auth = await begin(request, recorder)
    const body = await readJson<Record<string, unknown>>(request)
    const documents = body?.documents
    if (!body || typeof body.query !== "string" || !body.query.trim())
      throw new GatewayError(400, "`query` is required.", "invalid_request")
    if (!Array.isArray(documents) || !documents.length)
      throw new GatewayError(
        400,
        "`documents` must be a non-empty array.",
        "invalid_request"
      )
    captureRequestContext(recorder, request, body)
    // Documents are strings or objects with a `text` field.
    const texts = documents.map((doc) =>
      typeof doc === "string"
        ? doc
        : typeof (doc as { text?: unknown })?.text === "string"
          ? (doc as { text: string }).text
          : null
    )
    const [query, ...scrubbed] = protectTexts(
      auth.app,
      [body.query, ...texts.map((text) => text ?? "")],
      recorder
    )
    const docs = documents.map((doc, index) =>
      texts[index] === null
        ? doc
        : typeof doc === "string"
          ? scrubbed[index]
          : { ...(doc as object), text: scrubbed[index] }
    )
    if (recorder.logPayloads)
      recorder.requestBody = { ...body, query, documents: docs }
    const { response, model } = await executeMedia({
      kind: "rerank",
      path: "rerank",
      model: requireModel(body.model),
      app: auth.app,
      policy: auth.owner.policy,
      body: (modelId) =>
        JSON.stringify({ ...body, query, documents: docs, model: modelId }),
      signal: request.signal,
      recorder,
    })
    const result = (await response.json()) as {
      usage?: unknown
      meta?: { billed_units?: { search_units?: number } }
    }
    recorder.usage = mediaUsage(result.usage) ?? {
      inputTokens: estimateTokens(
        [query, ...texts.map((text) => text ?? "")].join(" ")
      ),
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      estimated: true,
    }
    chargeUnits(recorder, model, result.meta?.billed_units?.search_units ?? 1)
    if (recorder.logPayloads) recorder.responseBody = result
    recorder.finish()
    return Response.json(result, { headers: gatewayHeaders(recorder, model) })
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
