import "server-only"

import type { AccessPolicy } from "@/lib/access"
import type { GatewayApp, ModelKind } from "@/lib/db/types"

import { adapterFor } from "./adapters"
import { getSnapshot, type GatewaySnapshot, type ModelRuntime } from "./config"
import {
  ClientAbortError,
  GatewayError,
  UpstreamError,
  toUpstreamError,
} from "./errors"
import { decideOnFailure, recordFailure, recordSuccess } from "./health"
import type { RequestRecorder } from "./recorder"
import { resolveModel, type Resolution } from "./router"
import type {
  ChatChunk,
  ChatCompletion,
  ChatRequest,
  EmbeddingsRequest,
  EmbeddingsResponse,
  Usage,
} from "./types"
import { estimateRequestTokens, estimateTokens, usageFromChat } from "./usage"

interface AttemptContext {
  signal: AbortSignal
  abort(reason: unknown): void
  /** Keep the timeout and client-abort link alive after the attempt returns; call the result when done. */
  hold(): () => void
}

type Attempt<T> = (model: ModelRuntime, ctx: AttemptContext) => Promise<T>

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * Tries candidates in order until one succeeds. Failed models are put into
 * cooldown (shared across instances) so later requests skip them, and the
 * caller never sees the individual failures unless every attempt fails.
 */
async function withFailover<T>(
  snapshot: GatewaySnapshot,
  resolution: Resolution,
  recorder: RequestRecorder,
  clientSignal: AbortSignal,
  attempt: Attempt<T>
): Promise<{ value: T; model: ModelRuntime }> {
  const queue = [...resolution.candidates]
  const retried = new Set<string>()
  let lastError: UpstreamError | undefined
  let lastTransient: ModelRuntime | undefined

  for (let i = 0; i < resolution.maxAttempts; i++) {
    let model = queue.shift()
    if (!model && lastTransient && !retried.has(lastTransient.id)) {
      // Every candidate failed; give a transiently failing one a second chance.
      retried.add(lastTransient.id)
      model = lastTransient
      await sleep(400, clientSignal)
    }
    if (!model) break
    if (clientSignal.aborted) throw new ClientAbortError()

    const started = Date.now()
    const controller = new AbortController()
    const onClientAbort = () => controller.abort(new ClientAbortError())
    clientSignal.addEventListener("abort", onClientAbort, { once: true })
    const timer = setTimeout(
      () =>
        controller.abort(
          new UpstreamError(
            `Upstream timed out after ${resolution.timeoutMs / 1000}s`,
            null,
            { kind: "timeout" }
          )
        ),
      resolution.timeoutMs
    )
    let held = false
    const release = () => {
      clearTimeout(timer)
      clientSignal.removeEventListener("abort", onClientAbort)
    }

    try {
      const value = await attempt(model, {
        signal: controller.signal,
        abort: (reason) => controller.abort(reason),
        hold: () => {
          held = true
          return release
        },
      })
      if (!held) release()
      recordSuccess(model, snapshot)
      recorder.attempts.push({
        model_id: model.id,
        model: model.slug,
        provider: model.provider.name,
        status: 200,
        latency_ms: Date.now() - started,
      })
      recorder.served = model
      return { value, model }
    } catch (error) {
      release()
      if (clientSignal.aborted || error instanceof ClientAbortError)
        throw new ClientAbortError()

      const reason = controller.signal.aborted
        ? controller.signal.reason
        : error
      const upstream = toUpstreamError(
        reason instanceof UpstreamError ? reason : error
      )
      const decision = decideOnFailure(snapshot, model.id, upstream)
      recordFailure(model, snapshot, upstream, decision.cooldownSeconds)
      recorder.attempts.push({
        model_id: model.id,
        model: model.slug,
        provider: model.provider.name,
        status: upstream.status,
        error: upstream.message.slice(0, 500),
        latency_ms: Date.now() - started,
        ...(decision.cooldownSeconds
          ? { cooldown_s: decision.cooldownSeconds }
          : {}),
      })
      lastError = upstream
      if (decision.transient) lastTransient = model
      if (!decision.failover) break
    }
  }

  throw finalError(lastError, recorder)
}

function finalError(
  lastError: UpstreamError | undefined,
  recorder: RequestRecorder
): GatewayError {
  const attempts = recorder.attempts
  if (!lastError) {
    return new GatewayError(
      503,
      "No models were available to serve this request.",
      "no_available_models"
    )
  }
  if (attempts.length && attempts.every((a) => a.status === 429)) {
    const cooldowns = attempts.map((a) => a.cooldown_s ?? 60)
    return new GatewayError(
      429,
      `Every model for '${recorder.requestedModel}' is rate limited. Last error: ${lastError.message}`,
      "rate_limit_exceeded",
      "rate_limit_error",
      { "Retry-After": String(Math.min(...cooldowns)) }
    )
  }
  const last = attempts.at(-1)
  const where = last ? ` (${last.provider} · ${last.model})` : ""
  if (lastError.status && [400, 413, 422].includes(lastError.status)) {
    return new GatewayError(
      lastError.status,
      `The upstream model rejected the request${where}: ${lastError.message}`,
      "upstream_invalid_request"
    )
  }
  return new GatewayError(
    502,
    `All ${attempts.length} upstream attempt(s) failed. Last error${where}: ${lastError.message}`,
    "upstream_error"
  )
}

/**
 * Fails the attempt (and aborts it) if a stream has not produced its first
 * chunk in time, counting from the request, so a provider that hangs before
 * sending headers is caught too.
 */
function firstTokenDeadline(timeoutMs: number, ctx: AttemptContext) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new UpstreamError(
        `No response within ${timeoutMs / 1000}s`,
        null,
        { kind: "timeout" }
      )
      ctx.abort(error)
      reject(error)
    }, timeoutMs)
  })
  expired.catch(() => {})
  return {
    race: <T>(promise: Promise<T>) => Promise.race([promise, expired]),
    clear: () => clearTimeout(timer),
  }
}

async function* resume(
  first: ChatChunk,
  iterator: AsyncIterator<ChatChunk>,
  release: () => void
): AsyncGenerator<ChatChunk> {
  try {
    yield first
    while (true) {
      const next = await iterator.next()
      if (next.done) return
      yield next.value
    }
  } finally {
    release()
    await iterator.return?.().catch(() => {})
  }
}

type ChatOutput =
  | { type: "json"; completion: ChatCompletion }
  | { type: "stream"; chunks: AsyncGenerator<ChatChunk> }

export type ChatExecution = ChatOutput & { model: ModelRuntime }

export async function executeChat(options: {
  request: ChatRequest
  app: GatewayApp | null
  policy?: AccessPolicy
  /** Whose private providers may be used (default: the app's owner). */
  privateOwner?: string | null
  signal: AbortSignal
  recorder: RequestRecorder
}): Promise<ChatExecution> {
  const { request, recorder } = options
  recorder.requestedModel = request.model || undefined
  recorder.stream = Boolean(request.stream)
  const snapshot = await getSnapshot()
  const resolution = resolveModel(
    snapshot,
    request.model,
    "chat",
    options.app,
    request,
    options.policy,
    options.privateOwner === undefined
      ? (options.app?.owner_email ?? null)
      : options.privateOwner
  )
  recorder.requestedModel = resolution.requestedModel
  recorder.route = resolution.route

  const { value, model } = await withFailover(
    snapshot,
    resolution,
    recorder,
    options.signal,
    async (candidate, ctx): Promise<ChatOutput> => {
      const adapter = adapterFor(candidate.provider.type)
      const call = adapter.chat(
        { ...request, model: candidate.model_id },
        { model: candidate, signal: ctx.signal }
      )
      if (!request.stream) {
        const result = await call
        if (result.type !== "json")
          throw new UpstreamError("Expected a JSON response", 502)
        return result
      }

      // Only commit to this model once it has produced its first chunk.
      const deadline = firstTokenDeadline(resolution.firstTokenTimeoutMs, ctx)
      let iterator: AsyncIterator<ChatChunk> | undefined
      try {
        const result = await deadline.race(call)
        if (result.type === "json") return result
        iterator = result.chunks[Symbol.asyncIterator]()
        const first = await deadline.race(iterator.next())
        if (first.done) {
          throw new UpstreamError(
            "Upstream stream ended without any data",
            502,
            { kind: "stream" }
          )
        }
        recorder.ttftMs = Date.now() - recorder.startedAt
        return {
          type: "stream",
          chunks: resume(first.value, iterator, ctx.hold()),
        }
      } catch (error) {
        void iterator?.return?.().catch(() => {})
        throw error
      } finally {
        deadline.clear()
      }
    }
  )
  return { ...value, model }
}

/** Tracks usage and output while passing chunks through; finishes the recorder at the end. */
export async function* observeChat(
  chunks: AsyncIterable<ChatChunk>,
  recorder: RequestRecorder,
  request: ChatRequest
): AsyncGenerator<ChatChunk> {
  let usage: Usage | undefined
  let outputChars = 0
  let completed = false
  let failure: unknown
  const collected = {
    content: "",
    reasoning_content: "",
    tool_calls: [] as { name?: string; arguments: string }[],
  }

  try {
    for await (const chunk of chunks) {
      if (chunk.usage) usage = usageFromChat(chunk.usage) ?? usage
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta ?? {}
        if (typeof delta.content === "string") {
          outputChars += delta.content.length
          if (recorder.logPayloads) collected.content += delta.content
        }
        if (typeof delta.reasoning_content === "string") {
          outputChars += delta.reasoning_content.length
          if (recorder.logPayloads)
            collected.reasoning_content += delta.reasoning_content
        }
        for (const call of delta.tool_calls ?? []) {
          const args = call.function?.arguments ?? ""
          outputChars += args.length + (call.function?.name?.length ?? 0)
          if (recorder.logPayloads) {
            const entry = (collected.tool_calls[call.index] ??= {
              arguments: "",
            })
            if (call.function?.name) entry.name = call.function.name
            entry.arguments += args
          }
        }
      }
      yield chunk
    }
    completed = true
  } catch (error) {
    failure = error
    throw error
  } finally {
    recorder.usage = usage ?? {
      inputTokens: estimateRequestTokens(request),
      outputTokens: Math.ceil(outputChars / 4),
      cachedTokens: 0,
      reasoningTokens: 0,
      estimated: true,
    }
    if (recorder.logPayloads) recorder.responseBody = collected
    if (failure)
      recorder.fail(502, `Stream failed: ${toUpstreamError(failure).message}`)
    else if (!completed) recorder.fail(499, "Client closed the stream")
    else recorder.finish()
  }
}

export function finishJson(
  recorder: RequestRecorder,
  completion: ChatCompletion,
  request: ChatRequest
) {
  const text = completion.choices
    .map(
      (choice) =>
        `${choice.message?.content ?? ""}${choice.message?.reasoning_content ?? ""}${JSON.stringify(choice.message?.tool_calls ?? "")}`
    )
    .join("")
  recorder.usage = usageFromChat(completion.usage) ?? {
    inputTokens: estimateRequestTokens(request),
    outputTokens: estimateTokens(text),
    cachedTokens: 0,
    reasoningTokens: 0,
    estimated: true,
  }
  if (recorder.logPayloads) recorder.responseBody = completion
  recorder.finish()
}

export async function executeEmbeddings(options: {
  request: EmbeddingsRequest
  app: GatewayApp | null
  policy?: AccessPolicy
  /** Whose private providers may be used (default: the app's owner). */
  privateOwner?: string | null
  signal: AbortSignal
  recorder: RequestRecorder
}): Promise<{ response: EmbeddingsResponse; model: ModelRuntime }> {
  const { request, recorder } = options
  recorder.requestedModel = request.model || undefined
  const snapshot = await getSnapshot()
  const resolution = resolveModel(
    snapshot,
    request.model,
    "embedding" satisfies ModelKind,
    options.app,
    undefined,
    options.policy,
    options.privateOwner === undefined
      ? (options.app?.owner_email ?? null)
      : options.privateOwner
  )
  recorder.requestedModel = resolution.requestedModel
  recorder.route = resolution.route

  const { value, model } = await withFailover(
    snapshot,
    resolution,
    recorder,
    options.signal,
    (candidate, ctx) =>
      adapterFor(candidate.provider.type).embeddings(
        { ...request, model: candidate.model_id },
        { model: candidate, signal: ctx.signal }
      )
  )
  const inputs = Array.isArray(request.input) ? request.input : [request.input]
  const prompt = value.usage?.prompt_tokens
  recorder.usage = {
    inputTokens:
      prompt ??
      inputs.reduce<number>(
        (sum, item) =>
          sum +
          estimateTokens(
            typeof item === "string" ? item : JSON.stringify(item)
          ),
        0
      ),
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    estimated: prompt == null,
  }
  recorder.finish()
  return { response: value, model }
}
